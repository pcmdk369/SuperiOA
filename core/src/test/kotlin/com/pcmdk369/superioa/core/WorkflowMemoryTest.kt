package com.pcmdk369.superioa.core

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkflowMemoryTest {
    private val reusable = WorkflowRecord(
        id = "workflow-1",
        version = 1,
        appContext = "chrome",
        steps = listOf(
            ValidatedAction(
                type = ActionType.BACK,
                target = null,
                text = null,
                timeoutMs = 5_000,
                recommendation = "Return to the previous screen.",
                agent = "SuperiOA Coordinator",
                subAgent = "Device",
                skill = "Navigation",
            ),
        ),
        successCount = 9,
        failureCount = 1,
        confidence = 0.9,
        enabled = true,
        lastUsedEpochMs = 1_800_000_000_000,
    )

    @Test
    fun reusesOnlyEnabledHighConfidenceWorkflowInMatchingContext() {
        assertTrue(WorkflowReusePolicy.canReuse(reusable, "Chrome"))
        assertFalse(WorkflowReusePolicy.canReuse(reusable, "com.other.app"))
        assertFalse(WorkflowReusePolicy.canReuse(reusable.copy(confidence = 0.79), "chrome"))
        assertFalse(WorkflowReusePolicy.canReuse(reusable.copy(enabled = false), "chrome"))
    }

    @Test
    fun rejectsIncompleteWorkflowRecords() {
        assertFalse(WorkflowReusePolicy.canReuse(reusable.copy(steps = emptyList()), "chrome"))
        assertFalse(WorkflowReusePolicy.canReuse(reusable.copy(version = 0), "chrome"))
    }
}