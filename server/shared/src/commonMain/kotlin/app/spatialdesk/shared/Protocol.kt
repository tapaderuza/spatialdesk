@file:OptIn(ExperimentalJsExport::class)

package app.spatialdesk.shared

import kotlin.js.ExperimentalJsExport
import kotlin.js.JsExport
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Bumped when the wire format changes incompatibly; the server says it in Hello and the app shows it. */
const val PROTOCOL_VERSION = 1

/**
 * Messages the server sends over the workspace WebSocket. Times are epoch milliseconds as Double: they travel
 * as JSON numbers and are exported to JavaScript without BigInt conversions.
 */
@JsExport
@Serializable
sealed class ServerMessage {
    /** First message on every connection. */
    @Serializable
    @SerialName("hello")
    data class Hello(val sessionId: String, val serverTimeMs: Double, val protocol: Int) : ServerMessage()

    /** Answer to a client Ping: the client's own send time comes back, so it can measure the round trip. */
    @Serializable
    @SerialName("pong")
    data class Pong(val clientTimeMs: Double, val serverTimeMs: Double) : ServerMessage()
}

/** Messages the app sends. */
@JsExport
@Serializable
sealed class ClientMessage {
    @Serializable
    @SerialName("ping")
    data class Ping(val clientTimeMs: Double) : ClientMessage()
}

/** The one JSON configuration both sides use. */
val ProtocolJson: Json = Json {
    classDiscriminator = "type"
    ignoreUnknownKeys = true // an older app must survive a newer server
    encodeDefaults = true
}

/** String in, string out: the boundary the TypeScript side uses (no kotlinx types leak into the app). */
@JsExport
object Protocol {
    val version: Int get() = PROTOCOL_VERSION

    fun encodeClient(message: ClientMessage): String = ProtocolJson.encodeToString(ClientMessage.serializer(), message)

    fun encodeServer(message: ServerMessage): String = ProtocolJson.encodeToString(ServerMessage.serializer(), message)

    /** Null for anything this version can't read (unknown type, malformed JSON): never throws into the frame loop. */
    fun decodeServer(json: String): ServerMessage? =
        runCatching { ProtocolJson.decodeFromString(ServerMessage.serializer(), json) }.getOrNull()

    fun decodeClient(json: String): ClientMessage? =
        runCatching { ProtocolJson.decodeFromString(ClientMessage.serializer(), json) }.getOrNull()

    fun ping(clientTimeMs: Double): String = encodeClient(ClientMessage.Ping(clientTimeMs))
}
