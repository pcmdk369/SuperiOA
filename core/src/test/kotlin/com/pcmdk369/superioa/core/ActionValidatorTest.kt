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

    @Test
    fun requiresAReasonForExplicitApprovalAndRejectsOrphanReasons() {
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(
                listOf(ProposedAction(action = "TAP", target = "Send", requiresApproval = true)),
            ),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(
                listOf(ProposedAction(action = "BACK", approvalReason = "Sensitive action")),
            ),
        )
        assertIs<PlanValidation.Valid>(
            ActionValidator.validate(
                listOf(
                    ProposedAction(
                        action = "TAP",
                        target = "Send",
                        requiresApproval = true,
                        approvalReason = "Send a message",
                    ),
                ),
            ),
        )
    }

    @Test
    fun detectsSensitiveActionsIndependentlyOfThePlannerFlag() {
        val action = ValidatedAction(ActionType.TAP, "Pay now", null, 5_000)
        assertEquals(
            "This action may affect a sensitive or external operation.",
            SafetyGate.approvalReason(action),
        )
        assertEquals(
            null,
            SafetyGate.approvalReason(ValidatedAction(ActionType.BACK, null, null, 5_000)),
        )
    }
}