#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

REPO="${HOME}/SuperiOA"
if [[ ! -d "$REPO/.git" ]]; then
  echo "ERROR: $REPO is not a cloned Git repository."
  echo "Run: gh repo clone pcmdk369/SuperiOA"
  exit 1
fi
cd "$REPO"
echo "== SuperiOA architecture implementation =="
git status --short

mkdir -p \
  core/src/main/kotlin/com/pcmdk369/superioa/models \
  core/src/main/kotlin/com/pcmdk369/superioa/planner \
  core/src/main/kotlin/com/pcmdk369/superioa/orchestrator \
  core/src/main/kotlin/com/pcmdk369/superioa/validation \
  core/src/main/kotlin/com/pcmdk369/superioa/providers \
  core/src/test/kotlin/com/pcmdk369/superioa \
  app/src/main/java/com/pcmdk369/superioa/accessibility \
  app/src/main/java/com/pcmdk369/superioa/workflow \
  app/src/main/java/com/pcmdk369/superioa/memory \
  app/src/main/java/com/pcmdk369/superioa/safety \
  app/src/main/java/com/pcmdk369/superioa/network \
  skills/{android,browser,chat,creative,social,files,productivity} \
  backend/migrations backend/policies docs .github/agents .github/instructions .github/skills/frontend-design

cat > core/src/main/kotlin/com/pcmdk369/superioa/models/TaskModels.kt <<'EOF'
package com.pcmdk369.superioa.models

enum class TaskStatus { DRAFT, PLANNED, AWAITING_APPROVAL, RUNNING, COMPLETED, FAILED, CANCELLED }
enum class RiskLevel { LOW, MEDIUM, HIGH, CRITICAL }

data class UserTask(
    val id: String,
    val goal: String,
    val createdAtEpochMs: Long,
    val status: TaskStatus = TaskStatus.DRAFT
)

data class PlannedAction(
    val id: String,
    val skill: String,
    val action: String,
    val arguments: Map<String, String> = emptyMap(),
    val risk: RiskLevel = RiskLevel.LOW,
    val requiresApproval: Boolean = false,
    val timeoutMs: Long = 10_000
)

data class ActionPlan(
    val taskId: String,
    val summary: String,
    val actions: List<PlannedAction>,
    val createdAtEpochMs: Long
)

data class ActionResult(
    val actionId: String,
    val success: Boolean,
    val message: String,
    val startedAtEpochMs: Long,
    val finishedAtEpochMs: Long
)

data class WorkflowResult(
    val taskId: String,
    val status: TaskStatus,
    val actionResults: List<ActionResult>,
    val summary: String
)
EOF

cat > core/src/main/kotlin/com/pcmdk369/superioa/validation/PlanValidator.kt <<'EOF'
package com.pcmdk369.superioa.validation

import com.pcmdk369.superioa.models.ActionPlan
import com.pcmdk369.superioa.models.RiskLevel

data class ValidationIssue(val path: String, val message: String)
data class ValidationReport(val issues: List<ValidationIssue>) {
    val isValid: Boolean get() = issues.isEmpty()
}

class PlanValidator(
    private val allowedSkills: Set<String> = setOf(
        "android", "browser", "chat", "creative", "social", "files", "productivity"
    ),
    private val allowedActions: Set<String> = setOf(
        "wait", "open_app", "tap", "type_text", "scroll", "read_ui",
        "open_url", "search_web", "save_note", "speak"
    ),
    private val maxActions: Int = 40,
    private val maxArgumentChars: Int = 4_000,
    private val maxTimeoutMs: Long = 60_000
) {
    fun validate(plan: ActionPlan): ValidationReport {
        val issues = mutableListOf<ValidationIssue>()
        if (plan.taskId.isBlank()) issues += ValidationIssue("taskId", "Task ID is required.")
        if (plan.summary.isBlank()) issues += ValidationIssue("summary", "Plan summary is required.")
        if (plan.actions.isEmpty()) issues += ValidationIssue("actions", "At least one action is required.")
        if (plan.actions.size > maxActions) issues += ValidationIssue("actions", "Plan exceeds $maxActions actions.")
        plan.actions.forEachIndexed { index, action ->
            val path = "actions[$index]"
            if (action.id.isBlank()) issues += ValidationIssue("$path.id", "Action ID is required.")
            if (action.skill !in allowedSkills) issues += ValidationIssue("$path.skill", "Skill is not allowlisted.")
            if (action.action !in allowedActions) issues += ValidationIssue("$path.action", "Action is not allowlisted.")
            if (action.timeoutMs !in 1..maxTimeoutMs) issues += ValidationIssue("$path.timeoutMs", "Timeout must be 1..$maxTimeoutMs ms.")
            action.arguments.forEach { (key, value) ->
                if (key.isBlank()) issues += ValidationIssue("$path.arguments", "Argument keys cannot be blank.")
                if (value.length > maxArgumentChars) issues += ValidationIssue("$path.arguments.$key", "Argument exceeds $maxArgumentChars characters.")
            }
            if (action.risk in setOf(RiskLevel.HIGH, RiskLevel.CRITICAL) && !action.requiresApproval) {
                issues += ValidationIssue("$path.requiresApproval", "High-risk actions must require explicit user approval.")
            }
            if (action.action == "open_url") {
                val url = action.arguments["url"].orEmpty()
                if (!url.startsWith("https://")) issues += ValidationIssue("$path.arguments.url", "Only HTTPS URLs are allowed.")
            }
        }
        return ValidationReport(issues)
    }
}
EOF

cat > core/src/main/kotlin/com/pcmdk369/superioa/planner/Planner.kt <<'EOF'
package com.pcmdk369.superioa.planner

import com.pcmdk369.superioa.models.ActionPlan
import com.pcmdk369.superioa.models.UserTask

/**
 * Planning boundary. Implementations may call a trusted backend, but must return
 * structured data that is validated locally before any execution.
 */
interface TaskPlanner {
    suspend fun createPlan(task: UserTask): ActionPlan
}

class PlannerUnavailableException(message: String = "No planning provider is configured.") :
    IllegalStateException(message)
EOF

cat > core/src/main/kotlin/com/pcmdk369/superioa/providers/ProviderRouter.kt <<'EOF'
package com.pcmdk369.superioa.providers

/**
 * A provider must be configured by an application/backend adapter.
 * Never place provider API secrets in this shared Android/JVM module.
 */
data class ProviderRequest(
    val systemInstruction: String,
    val userContent: String,
    val responseFormat: String = "json"
)

data class ProviderResponse(val content: String, val providerId: String)

interface LlmProvider {
    val id: String
    suspend fun generate(request: ProviderRequest): ProviderResponse
}

class ProviderRouter(private val providers: List<LlmProvider>) {
    suspend fun generate(request: ProviderRequest): ProviderResponse {
        if (providers.isEmpty()) {
            throw IllegalStateException("No LLM provider configured. Add an authenticated backend adapter.")
        }
        var lastError: Throwable? = null
        for (provider in providers) {
            try {
                return provider.generate(request)
            } catch (error: Exception) {
                lastError = error
            }
        }
        throw IllegalStateException("All configured providers failed.", lastError)
    }
}
EOF

cat > core/src/main/kotlin/com/pcmdk369/superioa/orchestrator/TaskOrchestrator.kt <<'EOF'
package com.pcmdk369.superioa.orchestrator

import com.pcmdk369.superioa.models.*
import com.pcmdk369.superioa.validation.PlanValidator

interface ActionExecutor {
    suspend fun execute(action: PlannedAction): ActionResult
}

interface ApprovalGate {
    suspend fun approve(action: PlannedAction): Boolean
}

class TaskOrchestrator(
    private val validator: PlanValidator,
    private val executor: ActionExecutor,
    private val approvalGate: ApprovalGate,
    private val now: () -> Long = System::currentTimeMillis
) {
    suspend fun run(plan: ActionPlan): WorkflowResult {
        val report = validator.validate(plan)
        if (!report.isValid) {
            return WorkflowResult(plan.taskId, TaskStatus.FAILED, emptyList(),
                report.issues.joinToString("; ") { "${it.path}: ${it.message}" })
        }

        val results = mutableListOf<ActionResult>()
        for (action in plan.actions) {
            if (action.requiresApproval && !approvalGate.approve(action)) {
                return WorkflowResult(plan.taskId, TaskStatus.CANCELLED, results,
                    "Stopped because approval was not granted for action ${action.id}.")
            }
            val result = try {
                executor.execute(action)
            } catch (error: Exception) {
                ActionResult(action.id, false, error.message ?: "Action failed.",
                    now(), now())
            }
            results += result
            if (!result.success) {
                return WorkflowResult(plan.taskId, TaskStatus.FAILED, results,
                    "Workflow stopped after action ${action.id} failed.")
            }
        }
        return WorkflowResult(plan.taskId, TaskStatus.COMPLETED, results,
            "All ${results.size} actions completed and returned success.")
    }
}
EOF

cat > core/src/test/kotlin/com/pcmdk369/superioa/PlanValidatorTest.kt <<'EOF'
package com.pcmdk369.superioa

import com.pcmdk369.superioa.models.*
import com.pcmdk369.superioa.validation.PlanValidator
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlanValidatorTest {
    private val validator = PlanValidator()
    private fun plan(action: PlannedAction) = ActionPlan("task-1", "Test task", listOf(action), 1L)

    @Test fun acceptsAllowlistedWaitAction() {
        val report = validator.validate(plan(PlannedAction("a1", "android", "wait")))
        assertTrue(report.isValid, report.issues.toString())
    }

    @Test fun rejectsUnknownAction() {
        val report = validator.validate(plan(PlannedAction("a1", "android", "delete_everything")))
        assertFalse(report.isValid)
    }

    @Test fun rejectsInsecureUrl() {
        val report = validator.validate(plan(PlannedAction(
            "a1", "browser", "open_url", mapOf("url" to "http://example.com")
        )))
        assertFalse(report.isValid)
    }

    @Test fun highRiskRequiresApproval() {
        val report = validator.validate(plan(PlannedAction(
            "a1", "social", "speak", risk = RiskLevel.HIGH, requiresApproval = false
        )))
        assertFalse(report.isValid)
    }
}
EOF

cat > app/src/main/java/com/pcmdk369/superioa/safety/AndroidApprovalPolicy.kt <<'EOF'
package com.pcmdk369.superioa.safety

/**
 * UI-facing policy helper. The UI must ask the person to approve actions
 * classified as sensitive; this class does not grant Android permissions.
 */
enum class OperationRisk { NORMAL, SENSITIVE, IRREVERSIBLE }

data class ApprovalDecision(val allowed: Boolean, val reason: String)

object AndroidApprovalPolicy {
    fun evaluate(risk: OperationRisk, userApproved: Boolean): ApprovalDecision =
        when {
            risk == OperationRisk.NORMAL -> ApprovalDecision(true, "Normal operation.")
            userApproved -> ApprovalDecision(true, "Explicit approval supplied.")
            else -> ApprovalDecision(false, "User approval is required for this operation.")
        }
}
EOF

cat > app/src/main/java/com/pcmdk369/superioa/memory/WorkflowMemory.kt <<'EOF'
package com.pcmdk369.superioa.memory

import android.content.Context
import org.json.JSONArray

/**
 * Lightweight local-only workflow history. Do not store passwords, OTPs,
 * access tokens or sensitive screen contents here.
 */
class WorkflowMemory(context: Context) {
    private val preferences = context.getSharedPreferences("superioa_workflow_memory", Context.MODE_PRIVATE)

    fun readHistory(): List<String> = runCatching {
        val array = JSONArray(preferences.getString("history", "[]"))
        buildList { repeat(array.length()) { add(array.optString(it)) } }
    }.getOrDefault(emptyList())

    fun addHistory(goal: String) {
        val clean = goal.trim().take(1_000)
        if (clean.isEmpty()) return
        val history = (listOf(clean) + readHistory()).take(100)
        val array = JSONArray().apply { history.forEach(::put) }
        preferences.edit().putString("history", array.toString()).apply()
    }

    fun clear() { preferences.edit().remove("history").apply() }
}
EOF

cat > app/src/main/java/com/pcmdk369/superioa/network/BackendConfiguration.kt <<'EOF'
package com.pcmdk369.superioa.network

/**
 * Configuration placeholder only. It intentionally contains no credentials.
 * Remote calls must be implemented using an authenticated HTTPS backend.
 */
data class BackendConfiguration(
    val baseUrl: String? = null,
    val configured: Boolean = false
) {
    fun validate(): String? {
        if (!configured || baseUrl.isNullOrBlank()) return "Backend is not configured."
        if (!baseUrl.startsWith("https://")) return "Backend URL must use HTTPS."
        return null
    }
}
EOF

cat > app/src/main/java/com/pcmdk369/superioa/workflow/WorkflowStatus.kt <<'EOF'
package com.pcmdk369.superioa.workflow

enum class WorkflowStage {
    IDLE, PLANNING, VALIDATING, AWAITING_APPROVAL, EXECUTING, VERIFYING,
    COMPLETED, FAILED, CANCELLED
}

data class WorkflowUiState(
    val stage: WorkflowStage = WorkflowStage.IDLE,
    val message: String = "Ready",
    val cancellable: Boolean = false
)
EOF

cat > backend/migrations/001_workflow_schema.sql <<'EOF'
-- Supabase PostgreSQL schema proposal. Apply only after reviewing project auth model.
create extension if not exists pgcrypto;

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 4000),
  status text not null default 'draft'
    check (status in ('draft','planned','awaiting_approval','running','completed','failed','cancelled')),
  plan jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflow_runs_user_created_idx
  on public.workflow_runs(user_id, created_at desc);

alter table public.workflow_runs enable row level security;

drop policy if exists "Users read own workflows" on public.workflow_runs;
create policy "Users read own workflows" on public.workflow_runs
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users insert own workflows" on public.workflow_runs;
create policy "Users insert own workflows" on public.workflow_runs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users update own workflows" on public.workflow_runs;
create policy "Users update own workflows" on public.workflow_runs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete own workflows" on public.workflow_runs;
create policy "Users delete own workflows" on public.workflow_runs
  for delete to authenticated using (auth.uid() = user_id);

-- Do not add public/anon write policies. Keep service-role keys server-side.
EOF

cat > backend/policies/README.md <<'EOF'
# Backend security policy notes

- Apply migrations only after confirming Supabase Auth is enabled and the ownership model matches the app.
- Keep Row Level Security enabled on every user-owned table.
- Never ship the Supabase service-role key in Android or web client code.
- Validate task plans on the trusted server and again in the local core before execution.
- Do not store passwords, OTP codes, authentication cookies, or unnecessary screen contents in workflow history.
- Rate-limit LLM endpoints and enforce user ownership server-side.
EOF

cat > skills/README.md <<'EOF'
# SuperiOA Skills Catalog

A skill is a bounded capability contract, not a separate autonomous AI brain. The catalog below describes intended scope; a definition file is not proof that device or provider integration is implemented.

| Domain | Intended capability | Current status |
|---|---|---|
| android | App discovery and user-approved accessibility actions | Scaffold / requires device service and explicit enablement |
| browser | HTTPS navigation and browser task workflows | Interface only until adapter is implemented |
| chat | Compose messages and draft replies | Draft-only until app-specific adapter exists |
| creative | Generate outlines and creative briefs | Requires configured LLM provider |
| social | Prepare posts and preview publishing | Draft-only; publishing requires explicit confirmation |
| files | Create or inspect user-selected files | Requires scoped file access implementation |
| productivity | Task lists, reminders and notes | Local scaffold; integrations require implementation |

Every skill must document inputs, outputs, permissions, risk level, approval requirements, verification method, failure recovery and tests. Never bypass login, CAPTCHA, OTP, device permission prompts or application security controls.
EOF

for domain in android browser chat creative social files productivity; do
  cat > "skills/$domain/SKILL.md" <<EOF
# ${domain^} Skill

## Status
Specification/scaffold. Do not claim an integration is operational until implemented and tested.

## Contract
- Accept a bounded, validated task request.
- Return a structured proposal/result; do not execute arbitrary model-generated code.
- Declare required permissions and expected side effects.
- Mark sensitive or irreversible actions as requiring explicit user approval.
- Verify the outcome and return a truthful success/failure result.
- Never bypass authentication, CAPTCHA, OTP, permission prompts or platform security.
- Keep secrets out of client code and logs.
EOF
done

cat > .github/agents/superioa-implementation.agent.md <<'EOF'
---
name: superioa-implementation
description: Implement SuperiOA Android, core orchestration, skills and backend integrations safely.
---
# SuperiOA Implementation Agent
Read AGENTS.md, List.md, superioa_solution.md, README.md and docs before coding. Inspect existing files and git status. Preserve existing functionality. Implement in small vertical slices: models and validation, planner adapter, orchestration, Android approval UX, accessibility service, browser adapter, local memory, then authenticated backend. Do not claim placeholder interfaces are working integrations. Do not execute arbitrary LLM output. Validate all plans, bound timeouts/payloads, require explicit approval for sensitive actions, and stop on failed verification. Keep provider credentials server-side. Update manifest only for a fully implemented, disclosed, user-enabled accessibility service. Add unit tests, run :core:test and Android build where the SDK is available, fix failures, and report exact results.
EOF

cat > .github/instructions/kotlin-android.instructions.md <<'EOF'
# Kotlin / Android Instructions
- Use Kotlin, structured concurrency when coroutine dependencies are present, and explicit interfaces between UI, planning and execution.
- Never run model output as code or accept arbitrary package/class names as actions.
- Validate every action against a strict allowlist and bounded arguments/timeouts.
- AccessibilityService must be clearly disclosed, user-enabled in Android Settings and used only for the user's requested task.
- Never bypass permission screens, authentication, CAPTCHA, OTP, biometric prompts or app security.
- Sensitive, financial, publishing, deletion and irreversible operations require explicit user confirmation.
- Keep secrets out of APKs and source control. Use an authenticated HTTPS backend.
- Keep local workflow history minimal and avoid storing credentials or sensitive screen text.
- Test validation and orchestration independently from Android UI automation.
EOF

cat > docs/IMPLEMENTATION_STATUS.md <<'EOF'
# Implementation Status

This script adds the following source scaffolding:
- Typed task/action/plan/result models.
- Strict allowlist-based plan validator.
- Planner and LLM provider interfaces.
- Sequential orchestrator with approval gate and fail-stop behavior.
- Android approval policy helper.
- Local-only workflow memory helper.
- Backend configuration validation placeholder.
- Supabase workflow schema with per-user RLS policies.
- Skill specifications, agent instructions and architecture documentation.
- Unit tests for key plan-validation rules.

## Not yet connected by these files alone
- A production LLM provider or structured JSON parser.
- Remote Supabase client/authentication and migration deployment.
- A fully registered and user-enabled AccessibilityService.
- Real Android UI actions, OCR, browser automation or TTS.
- Cross-device sync, durable execution queue, or production monitoring.

## Verification
Run:
\`\`\`sh
gradle :core:test --no-daemon
gradle :app:assembleDebug --no-daemon
git diff --check
\`\`\`
Record actual output. Android builds require a compatible JDK, Gradle, Android Gradle Plugin and installed SDK. Do not describe an unrun command as passing.
EOF

cat > docs/SUPERIOA_ARCHITECTURE.md <<'EOF'
# SuperiOA Architecture

User text/voice -> Android UI -> Master Agent -> provider router -> task planner -> task orchestrator -> skill contract -> plan validator/safety gate -> user approval where needed -> bounded executor -> result verification -> local workflow memory -> optional authenticated Supabase persistence and TTS status.

## Trust boundaries
- LLM output is untrusted data, never executable code.
- Validate all plans on-device before execution; a trusted backend should validate too.
- The executor accepts only known action names, bounded arguments and bounded timeouts.
- Accessibility actions require clear disclosure and explicit system enablement.
- Stop the workflow when an action fails or verification is inconclusive.
- Do not store passwords, OTP codes, tokens or unnecessary screen contents.
- Cloud sync and external providers remain disabled until configured and tested.
EOF

echo "== Running validation =="
git diff --check
if command -v gradle >/dev/null 2>&1; then
  gradle :core:test --no-daemon || echo "WARNING: core tests failed; review output above."
else
  echo "Gradle not installed; tests not run."
fi

echo "== Files changed =="
git status --short
echo
echo "Review the diff before pushing. This script does not overwrite the existing MainActivity or AndroidManifest."
echo "To commit and push these changes, run:"
echo "  cd ~/SuperiOA && git add core app skills backend docs .github && git commit -m 'Implement SuperiOA orchestration architecture scaffolding' && git push origin main"
