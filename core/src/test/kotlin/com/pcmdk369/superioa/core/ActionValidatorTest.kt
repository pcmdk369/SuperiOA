package com.pcmdk369.superioa.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ActionValidatorTest {
    @Test
    fun acceptsValidPlanAndAppliesDefaultTimeout() {
        val result = ActionValidator.validate(
            listOf(ProposedAction(action = "OPEN_APP", target = "Chrome")),
        )

        val plan = assertIs<PlanValidation.Valid>(result).plan
        assertEquals(ActionType.OPEN_APP, plan.actions.single().type)
        assertEquals(5_000, plan.actions.single().timeoutMs)
    }

    @Test
    fun rejectsUnknownActionAndMissingRequiredFields() {
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(ProposedAction(action = "RUN_SHELL"))),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(ProposedAction(action = "TAP"))),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(ProposedAction(action = "TYPE", target = "Search"))),
        )
    }

    @Test
    fun rejectsOutOfRangeTimeoutAndUnexpectedFields() {
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(ProposedAction(action = "WAIT", timeoutMs = 30_001))),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(ProposedAction(action = "BACK", text = "unexpected"))),
        )
    }

    @Test
    fun rejectsPlansOutsideActionCountBounds() {
        assertIs<PlanValidation.Invalid>(ActionValidator.validate(emptyList()))
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(List(51) { ProposedAction(action = "BACK") }),
        )
    }
}