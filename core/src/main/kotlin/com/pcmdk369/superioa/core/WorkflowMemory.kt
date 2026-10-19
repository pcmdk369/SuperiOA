package com.pcmdk369.superioa.core

data class WorkflowRecord(
    val id: String,
    val version: Int,
    val appContext: String,
    val steps: List<ValidatedAction>,
    val successCount: Int,
    val failureCount: Int,
    val confidence: Double,
    val enabled: Boolean,
    val lastUsedEpochMs: Long?,
)

object WorkflowReusePolicy {
    const val DEFAULT_MIN_CONFIDENCE = 0.8

    fun canReuse(
        workflow: WorkflowRecord,
        appContext: String,
        minimumConfidence: Double = DEFAULT_MIN_CONFIDENCE,
    ): Boolean {
        require(minimumConfidence in 0.0..1.0)
        return workflow.enabled &&
            workflow.version > 0 &&
            workflow.steps.isNotEmpty() &&
            workflow.appContext.equals(appContext, ignoreCase = true) &&
            workflow.confidence in minimumConfidence..1.0
    }
}