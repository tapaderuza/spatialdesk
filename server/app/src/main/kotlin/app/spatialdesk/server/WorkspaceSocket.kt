package app.spatialdesk.server

import app.spatialdesk.shared.ClientMessage
import app.spatialdesk.shared.PROTOCOL_VERSION
import app.spatialdesk.shared.Protocol
import app.spatialdesk.shared.ServerMessage
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.http.server.ServerHttpRequest
import org.springframework.http.server.ServerHttpResponse
import org.springframework.http.server.ServletServerHttpRequest
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator
import org.springframework.web.socket.handler.TextWebSocketHandler
import org.springframework.web.socket.server.HandshakeInterceptor
import java.time.Clock
import java.util.concurrent.ConcurrentHashMap

/**
 * The workspace hub every headset connects to. Week 1: Hello on connect, Ping -> Pong for clock sync, and a
 * server keep-alive so idle sockets survive CloudFront and the ALB. Week 3 adds the agent's workspace updates.
 */
@Component
class WorkspaceSocket(private val clock: Clock) : TextWebSocketHandler() {
    private val log = LoggerFactory.getLogger(javaClass)
    private val sockets = ConcurrentHashMap<String, WebSocketSession>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        // The decorator serialises concurrent sends (keep-alive vs. replies) and drops slow consumers.
        val safe = ConcurrentWebSocketSessionDecorator(session, 5_000, 256 * 1024)
        sockets[session.id] = safe
        val workspaceId = session.attributes[WORKSPACE_ATTR] as String
        send(safe, ServerMessage.Hello(workspaceId, clock.millis().toDouble(), PROTOCOL_VERSION))
        log.info("workspace connected socket={} live={}", session.id, sockets.size)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        when (val msg = Protocol.decodeClient(message.payload)) {
            is ClientMessage.Ping -> sockets[session.id]?.let { send(it, ServerMessage.Pong(msg.clientTimeMs, clock.millis().toDouble())) }
            null -> log.debug("ignored unreadable message on socket={}", session.id)
        }
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        sockets.remove(session.id)
    }

    /** Below CloudFront's and the ALB's idle timeouts; clientTimeMs 0 marks it as a keep-alive, not a reply. */
    @Scheduled(fixedRate = 25_000)
    fun keepAlive() {
        val now = clock.millis().toDouble()
        sockets.values.forEach { send(it, ServerMessage.Pong(0.0, now)) }
    }

    val liveCount: Int get() = sockets.size

    private fun send(session: WebSocketSession, message: ServerMessage) {
        runCatching { session.sendMessage(TextMessage(Protocol.encodeServer(message))) }
            .onFailure { log.debug("send failed on socket={}: {}", session.id, it.message) }
    }

    companion object {
        const val WORKSPACE_ATTR = "workspaceId"
    }
}

/** Only sessions created through POST /api/sessions may open a socket. */
@Component
class SessionHandshake(private val registry: SessionRegistry) : HandshakeInterceptor {
    override fun beforeHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Boolean {
        val id = (request as? ServletServerHttpRequest)?.servletRequest?.getParameter("session")
        if (id == null || !registry.isValid(id)) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED)
            return false
        }
        attributes[WorkspaceSocket.WORKSPACE_ATTR] = id
        return true
    }

    override fun afterHandshake(request: ServerHttpRequest, response: ServerHttpResponse, wsHandler: WebSocketHandler, exception: Exception?) = Unit
}

@Configuration
@EnableWebSocket
class WebSocketConfig(private val socket: WorkspaceSocket, private val handshake: SessionHandshake) : WebSocketConfigurer {
    // Same origin through CloudFront in production; the Vite dev server proxies /ws locally.
    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(socket, "/ws").addInterceptors(handshake).setAllowedOriginPatterns("*")
    }
}
