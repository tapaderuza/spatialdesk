@file:OptIn(ExperimentalJsExport::class)

package app.spatialdesk.shared

import kotlin.js.ExperimentalJsExport
import kotlin.js.JsExport
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/** What [Workspaces.apply] returns, as JSON. */
@Serializable
data class ApplyResult(
    val ok: Boolean,
    val state: Workspace? = null,
    val created: List<String> = emptyList(),
    val error: String? = null,
    val opIndex: Int? = null,
)

/**
 * The workspace engine for TypeScript: JSON strings in and out, like [Protocol], so no Kotlin types leak into the
 * app. Called on user actions and agent plans, never per frame.
 */
@JsExport
object Workspaces {
    val schema: Int get() = WORKSPACE_SCHEMA

    fun empty(): String = encode(Workspace())

    /** A saved workspace, normalised; null when it is unreadable or from another schema (the app then starts fresh). */
    fun load(json: String): String? = runCatching { WorkspaceJson.decodeFromString(Workspace.serializer(), json) }
        .getOrNull()
        ?.takeIf { it.schema == WORKSPACE_SCHEMA }
        ?.let(::encode)

    /**
     * Applies one op (a JSON object) or a batch (an array), atomically. [viewerJson] is the user's current eye pose,
     * used only by arrange_space; pass null to keep the stored anchor.
     */
    fun apply(stateJson: String, opsJson: String, nowMs: Double, viewerJson: String?): String {
        val state = runCatching { WorkspaceJson.decodeFromString(Workspace.serializer(), stateJson) }.getOrNull()
            ?: return result(ApplyResult(ok = false, error = "The workspace could not be read.", opIndex = -1))
        val viewer = viewerJson?.let { runCatching { WorkspaceJson.decodeFromString(Pose.serializer(), it) }.getOrNull() }
        val ops = when (val parsed = decodeOps(opsJson)) {
            is ParsedOps.Ok -> parsed.ops
            is ParsedOps.Bad -> return result(ApplyResult(ok = false, error = parsed.error, opIndex = parsed.index))
        }
        return result(
            when (val outcome = WorkspaceEngine.applyAll(state, ops, nowMs, viewer)) {
                is EngineResult.Success -> ApplyResult(ok = true, state = outcome.state, created = outcome.created)
                is EngineResult.Failure -> ApplyResult(ok = false, error = outcome.error, opIndex = outcome.opIndex)
            },
        )
    }

    /** Where the command panel goes for this workspace's anchor (it is scene content, not workspace state). */
    fun commandPose(stateJson: String): String {
        val anchor = runCatching { WorkspaceJson.decodeFromString(Workspace.serializer(), stateJson).anchor }.getOrDefault(Layout.DEFAULT_ANCHOR)
        return WorkspaceJson.encodeToString(Pose.serializer(), Layout.command(anchor))
    }

    /** Where the agent's plan preview goes for this workspace's anchor. */
    fun previewPose(stateJson: String): String {
        val anchor = runCatching { WorkspaceJson.decodeFromString(Workspace.serializer(), stateJson).anchor }.getOrDefault(Layout.DEFAULT_ANCHOR)
        return WorkspaceJson.encodeToString(Pose.serializer(), Layout.preview(anchor))
    }

    private fun encode(ws: Workspace): String = WorkspaceJson.encodeToString(Workspace.serializer(), ws)

    private fun result(r: ApplyResult): String = WorkspaceJson.encodeToString(ApplyResult.serializer(), r)
}

internal sealed class ParsedOps {
    class Ok(val ops: List<Op>) : ParsedOps()
    class Bad(val error: String, val index: Int) : ParsedOps()
}

/** One op or a list of them. The error names the action by position, so the agent can fix exactly that one. */
internal fun decodeOps(json: String): ParsedOps {
    val element = runCatching { WorkspaceJson.parseToJsonElement(json) }.getOrNull()
        ?: return ParsedOps.Bad("The actions are not valid JSON.", -1)
    val items: List<JsonElement> = if (element is JsonArray) element else listOf(element)
    val ops = items.mapIndexed { index, item ->
        runCatching { WorkspaceJson.decodeFromJsonElement(Op.serializer(), item) }.getOrElse { e ->
            val reason = e.message?.lineSequence()?.firstOrNull()?.take(160) ?: "unknown action"
            return ParsedOps.Bad("Action ${index + 1} is not one SpatialDesk understands: $reason", index)
        }
    }
    return ParsedOps.Ok(ops)
}
