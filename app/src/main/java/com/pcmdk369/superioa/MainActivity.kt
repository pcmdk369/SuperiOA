package com.pcmdk369.superioa

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.pcmdk369.superioa.core.ActionType
import com.pcmdk369.superioa.core.AgentPlan
import com.pcmdk369.superioa.core.SafetyGate
import com.pcmdk369.superioa.core.ValidatedAction
import org.json.JSONArray
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { SuperiOAApp() }
    }
}

private enum class AppTab(val label: String) {
    RUN("Run"), HISTORY("History"), SETTINGS("Settings")
}

private data class CheckpointUi(
    val title: String,
    val message: String,
    val actionDescription: String,
    val decide: (Boolean) -> Unit,
)

private class TaskExecutionFailure(message: String) : Exception(message)

@Composable
private fun SuperiOAApp() {
    val activity = LocalContext.current as Activity
    val preferences = remember { activity.getSharedPreferences("superioa", 0) }
    val memory = remember { LocalWorkflowMemory(preferences) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val history = remember {
        mutableStateListOf<String>().apply {
            val saved = JSONArray(preferences.getString("history", "[]"))
            repeat(saved.length()) { index -> add(saved.optString(index)) }
        }
    }
    val ttsReady = remember { mutableStateOf(false) }
    val textToSpeech = remember {
        TextToSpeech(activity) { status -> ttsReady.value = status == TextToSpeech.SUCCESS }
    }
    DisposableEffect(textToSpeech, executor) {
        onDispose {
            textToSpeech.stop()
            textToSpeech.shutdown()
            executor.shutdownNow()
        }
    }

    var selectedTab by rememberSaveable { mutableStateOf(AppTab.RUN) }
    var taskText by rememberSaveable { mutableStateOf("") }
    var feedback by rememberSaveable { mutableStateOf<String?>(null) }
    var projectUrl by rememberSaveable {
        mutableStateOf(preferences.getString("supabaseUrl", "").orEmpty())
    }
    var anonKey by rememberSaveable {
        mutableStateOf(preferences.getString("supabaseAnonKey", "").orEmpty())
    }
    var authEmail by rememberSaveable { mutableStateOf("") }
    var authPassword by remember { mutableStateOf("") }
    var accessToken by remember { mutableStateOf<String?>(null) }
    var shareScreenContext by rememberSaveable { mutableStateOf(false) }
    var speakResults by rememberSaveable { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var accessibilityEnabled by remember {
        mutableStateOf(SuperiOAAccessibilityService.isEnabled(activity))
    }
    var pendingPlan by remember { mutableStateOf<AgentPlanResult?>(null) }
    var pendingTask by remember { mutableStateOf("") }
    var pendingContext by remember { mutableStateOf("unknown") }
    var checkpoint by remember { mutableStateOf<CheckpointUi?>(null) }
    var taskFuture by remember { mutableStateOf<Future<*>?>(null) }
    val cancelled = remember { AtomicBoolean(false) }

    fun speak(text: String) {
        if (!speakResults) return
        if (ttsReady.value) {
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "superioa-status")
        } else {
            feedback = "On-device speech output is not available yet."
        }
    }

    fun persistHistory(task: String) {
        history.add(0, task)
        preferences.edit()
            .putString("history", JSONArray().apply { history.take(50).forEach(::put) }.toString())
            .apply()
    }

    fun askUser(title: String, message: String, actionDescription: String): Boolean {
        val decision = AtomicBoolean(false)
        val completed = CountDownLatch(1)
        activity.runOnUiThread {
            checkpoint = CheckpointUi(title, message, actionDescription) { accepted ->
                decision.set(accepted)
                checkpoint = null
                completed.countDown()
            }
        }
        return try {
            completed.await(CHECKPOINT_TIMEOUT_MS, TimeUnit.MILLISECONDS) && decision.get()
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            activity.runOnUiThread { checkpoint = null }
            false
        }
    }

    fun planTask(task: String) {
        val normalizedTask = task.trim()
        if (normalizedTask.isEmpty() || busy) return
        cancelled.set(false)
        val token = accessToken
        if (token.isNullOrBlank()) {
            feedback = "Sign in to Supabase in Settings before planning a task."
            selectedTab = AppTab.SETTINGS
            return
        }
        val appContext = SuperiOAAccessibilityService.active?.currentPackage() ?: "unknown"
        val service = SuperiOAAccessibilityService.active
        val screen = if (shareScreenContext) service?.safeUiSnapshot() else null
        busy = true
        feedback = "Planning the task with the SuperiOA coordinator…"
        pendingPlan = null
        taskFuture = executor.submit {
            try {
                val local = memory.find(normalizedTask, appContext)
                val result = local ?: AgentBackend.plan(
                    projectUrl = projectUrl,
                    anonKey = anonKey,
                    accessToken = token,
                    task = normalizedTask,
                    screenContext = screen,
                )
                if (cancelled.get() || Thread.currentThread().isInterrupted) {
                    activity.runOnUiThread {
                        busy = false
                        feedback = "Planning canceled. No actions were executed."
                    }
                    return@submit
                }
                activity.runOnUiThread {
                    pendingTask = normalizedTask
                    pendingContext = appContext
                    pendingPlan = result
                    busy = false
                    feedback = if (local != null) {
                        "Using a locally validated workflow. Review it before running."
                    } else {
                        "Plan ready from ${result.engineId}. Review the steps before running."
                    }
                    if (local != null) speak("I found a validated local workflow. ${result.plan.summary}")
                    else speak("${result.plan.summary}. ${result.plan.actions.actions.size} steps. Review before running.")
                }
            } catch (failure: Exception) {
                if (cancelled.get()) {
                    activity.runOnUiThread {
                        busy = false
                        feedback = "Planning canceled. No actions were executed."
                    }
                    return@submit
                }
                activity.runOnUiThread {
                    busy = false
                    feedback = failure.message ?: "Planning failed. Check the backend connection and try again."
                    speak("Planning failed. ${feedback.orEmpty()}")
                }
            }
        }
    }

    fun executePlan() {
        val result = pendingPlan ?: return
        if (busy) return
        accessibilityEnabled = SuperiOAAccessibilityService.isEnabled(activity)
        val service = SuperiOAAccessibilityService.active
        if (!accessibilityEnabled || service == null) {
            feedback = "Enable the SuperiOA Accessibility service in Android Settings before running this plan."
            activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return
        }

        cancelled.set(false)
        service.resetCancellation()
        busy = true
        feedback = "Executing locally. Actions will be verified as they run."
        taskFuture = executor.submit {
            var verified = false
            try {
                for (action in result.plan.actions.actions) {
                    if (cancelled.get() || Thread.currentThread().isInterrupted) {
                        throw InterruptedException("Task canceled.")
                    }
                    if (action.type == ActionType.WAIT) {
                        Thread.sleep(MIN_WAIT_MS.coerceAtMost(action.timeoutMs.toLong()))
                        continue
                    }
                    val approvalReason = SafetyGate.approvalReason(action)
                    if (approvalReason != null && !askUser(
                            title = "Approval required",
                            message = approvalReason,
                            actionDescription = describeAction(action),
                        )
                    ) {
                        throw InterruptedException("Task canceled at an approval checkpoint.")
                    }
                    if (action.type == ActionType.REQUEST_USER) continue

                    var outcome = service.execute(action)
                    if (outcome is ActionExecution.NeedsUser) {
                        val resume = askUser(
                            title = "SuperiOA paused for you",
                            message = outcome.reason,
                            actionDescription = describeAction(action),
                        )
                        if (!resume) throw InterruptedException("Task canceled at a user checkpoint.")
                        outcome = service.execute(action)
                    }
                    when (outcome) {
                        ActionExecution.Success -> if (action.type == ActionType.VERIFY) verified = true
                        is ActionExecution.Failed -> throw TaskExecutionFailure(outcome.reason)
                        is ActionExecution.NeedsUser -> throw TaskExecutionFailure(
                            "The security checkpoint is still active. The action was not retried.",
                        )
                        ActionExecution.Cancelled -> throw InterruptedException("Task canceled.")
                    }
                    activity.runOnUiThread { feedback = "Completed ${describeAction(action)}" }
                }
                if (!verified) throw TaskExecutionFailure("The workflow has no successful VERIFY step; it was not saved.")
                memory.recordSuccess(pendingTask, pendingContext, result)
                persistHistory(pendingTask)
                activity.runOnUiThread {
                    busy = false
                    pendingPlan = null
                    feedback = "Task completed and verified. The workflow was saved locally for reuse."
                    speak("Task completed and verified.")
                }
            } catch (_: InterruptedException) {
                activity.runOnUiThread {
                    busy = false
                    feedback = "Task canceled or paused. Check the target app before starting again."
                }
            } catch (failure: Exception) {
                memory.recordFailure(pendingTask)
                activity.runOnUiThread {
                    busy = false
                    feedback = "${failure.message ?: "Task failed."} No automatic side-effect retry was attempted."
                    speak("The task stopped. Check the current app state.")
                }
            }
        }
    }

    fun cancelTask() {
        cancelled.set(true)
        SuperiOAAccessibilityService.active?.cancelActions()
        checkpoint?.decide?.invoke(false)
        feedback = "Cancellation requested. SuperiOA will stop before the next action; check the current app state."
    }

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val phrase = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            if (!phrase.isNullOrBlank()) {
                taskText = phrase
                planTask(phrase)
            } else {
                feedback = "No speech was recognized. Try again or type your task."
            }
        } else {
            feedback = "Voice input was canceled. You can type your task instead."
        }
    }
    fun launchSpeechInput() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your task for SuperiOA")
        }
        try {
            speechLauncher.launch(intent)
        } catch (_: android.content.ActivityNotFoundException) {
            feedback = "No speech recognition service is available. Type your task instead."
        }
    }
    val audioPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) launchSpeechInput()
        else feedback = "Microphone permission was denied. Type your task instead."
    }

    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Color(0xFF176B57),
            onPrimary = Color.White,
            secondary = Color(0xFFB35332),
            background = Color(0xFFF5F6F2),
            surface = Color(0xFFF5F6F2),
            onSurface = Color(0xFF192923),
        ),
    ) {
        Scaffold(
            bottomBar = {
                NavigationBar {
                    AppTab.entries.forEach { tab ->
                        val icon = when (tab) {
                            AppTab.RUN -> Icons.Filled.PlayArrow
                            AppTab.HISTORY -> Icons.Filled.History
                            AppTab.SETTINGS -> Icons.Filled.Settings
                        }
                        NavigationBarItem(
                            selected = selectedTab == tab,
                            onClick = { selectedTab = tab },
                            icon = { Icon(icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            },
        ) { insets ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(insets)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp, vertical = 20.dp),
            ) {
                Text("SUPERIOA  /  INTELLIGENT OPERATION AGENT", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(8.dp))
                Text(
                    when (selectedTab) {
                        AppTab.RUN -> "What should I take care of?"
                        AppTab.HISTORY -> "Task history"
                        AppTab.SETTINGS -> "System setup"
                    },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(20.dp))
                when (selectedTab) {
                    AppTab.RUN -> RunScreen(
                        taskText = taskText,
                        onTaskTextChange = { taskText = it; feedback = null },
                        feedback = feedback,
                        plan = pendingPlan?.plan,
                        busy = busy,
                        shareScreenContext = shareScreenContext,
                        onShareScreenContextChange = { shareScreenContext = it },
                        speakResults = speakResults,
                        onSpeakResultsChange = { speakResults = it },
                        onListen = {
                            if (ContextCompat.checkSelfPermission(
                                    activity,
                                    Manifest.permission.RECORD_AUDIO,
                                ) == PackageManager.PERMISSION_GRANTED
                            ) {
                                launchSpeechInput()
                            } else {
                                audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        },
                        onPlan = { planTask(taskText) },
                        onExecute = ::executePlan,
                        onCancel = ::cancelTask,
                        onEnableAccessibility = {
                            activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                        },
                        accessibilityEnabled = accessibilityEnabled,
                    )
                    AppTab.HISTORY -> HistoryScreen(history)
                    AppTab.SETTINGS -> SettingsScreen(
                        projectUrl = projectUrl,
                        anonKey = anonKey,
                        email = authEmail,
                        password = authPassword,
                        signedIn = accessToken != null,
                        accessibilityEnabled = accessibilityEnabled,
                        feedback = feedback,
                        onProjectUrlChange = { projectUrl = it },
                        onAnonKeyChange = { anonKey = it },
                        onEmailChange = { authEmail = it },
                        onPasswordChange = { authPassword = it },
                        onSaveProject = {
                            if (!projectUrl.startsWith("https://", ignoreCase = true) || anonKey.isBlank()) {
                                feedback = "Enter an HTTPS Supabase URL and public anon key."
                            } else {
                                preferences.edit()
                                    .putString("supabaseUrl", projectUrl.trim().trimEnd('/'))
                                    .putString("supabaseAnonKey", anonKey.trim())
                                    .apply()
                                feedback = "Public Supabase settings saved on this device."
                            }
                        },
                        onSignIn = {
                            if (projectUrl.isBlank() || anonKey.isBlank() || authEmail.isBlank() || authPassword.isBlank()) {
                                feedback = "Enter the Supabase URL, public key, email, and password."
                            } else {
                                val url = projectUrl
                                val publicKey = anonKey
                                val email = authEmail
                                val password = authPassword
                                authPassword = ""
                                busy = true
                                feedback = "Signing in to Supabase Auth…"
                                taskFuture = executor.submit {
                                    try {
                                        val token = AgentBackend.signIn(url, publicKey, email, password)
                                        activity.runOnUiThread {
                                            accessToken = token
                                            busy = false
                                            feedback = "Signed in. The session token remains in memory only."
                                        }
                                    } catch (failure: Exception) {
                                        activity.runOnUiThread {
                                            busy = false
                                            feedback = failure.message ?: "Sign-in failed."
                                        }
                                    }
                                }
                            }
                        },
                        onSignOut = {
                            accessToken = null
                            feedback = "Signed out. The in-memory session was cleared."
                        },
                        onRefreshAccessibility = {
                            accessibilityEnabled = SuperiOAAccessibilityService.isEnabled(activity)
                            feedback = if (accessibilityEnabled) "Accessibility service is enabled."
                            else "Accessibility service is disabled."
                        },
                    )
                }
            }
        }
        checkpoint?.let { active ->
            AlertDialog(
                onDismissRequest = { active.decide(false) },
                title = { Text(active.title) },
                text = {
                    Column {
                        Text(active.message)
                        Spacer(Modifier.height(10.dp))
                        Text(active.actionDescription, fontWeight = FontWeight.SemiBold)
                    }
                },
                confirmButton = {
                    TextButton(onClick = { active.decide(true) }) { Text("Continue") }
                },
                dismissButton = {
                    TextButton(onClick = { active.decide(false) }) { Text("Stop task") }
                },
            )
        }
    }
}

@Composable
private fun RunScreen(
    taskText: String,
    onTaskTextChange: (String) -> Unit,
    feedback: String?,
    plan: AgentPlan?,
    busy: Boolean,
    shareScreenContext: Boolean,
    onShareScreenContextChange: (Boolean) -> Unit,
    speakResults: Boolean,
    onSpeakResultsChange: (Boolean) -> Unit,
    onListen: () -> Unit,
    onPlan: () -> Unit,
    onExecute: () -> Unit,
    onCancel: () -> Unit,
    onEnableAccessibility: () -> Unit,
    accessibilityEnabled: Boolean,
) {
    OutlinedTextField(
        value = taskText,
        onValueChange = onTaskTextChange,
        modifier = Modifier.fillMaxWidth(),
        minLines = 3,
        maxLines = 7,
        label = { Text("Describe a task") },
        placeholder = { Text("Example: Open Chrome and find recent project updates") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
    )
    Spacer(Modifier.height(12.dp))
    Button(onClick = onListen, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Filled.Mic, contentDescription = null, modifier = Modifier.size(20.dp))
        Text("  Talk to SuperiOA")
    }
    Spacer(Modifier.height(8.dp))
    Button(onClick = onPlan, enabled = taskText.isNotBlank() && !busy, modifier = Modifier.fillMaxWidth()) {
        Text("Plan task")
    }
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Checkbox(checked = shareScreenContext, onCheckedChange = onShareScreenContextChange)
        Text("Share accessible screen labels with the planner", style = MaterialTheme.typography.bodySmall)
    }
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Checkbox(checked = speakResults, onCheckedChange = onSpeakResultsChange)
        Text("Speak plans and status with Android Text-to-Speech", style = MaterialTheme.typography.bodySmall)
    }
    Spacer(Modifier.height(12.dp))
    feedback?.let {
        Surface(color = Color(0xFFE8EFE8), shape = MaterialTheme.shapes.small) {
            Text(it, modifier = Modifier.padding(14.dp), style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(14.dp))
    }
    if (busy) {
        Button(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Stop task") }
        Spacer(Modifier.height(14.dp))
    }
    plan?.let {
        HorizontalDivider()
        Spacer(Modifier.height(14.dp))
        Text("Plan preview", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(it.summary, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(4.dp))
        Text(
            "Route: ${it.domain} → ${it.subAgent}${it.preSubAgent?.let { skill -> " → $skill" }.orEmpty()} → ${it.skill}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text("Expected result: ${it.expectedResult}", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(10.dp))
        it.actions.actions.forEachIndexed { index, action ->
            Column(Modifier.fillMaxWidth().padding(vertical = 7.dp)) {
                Text("${index + 1}. ${describeAction(action)}", style = MaterialTheme.typography.bodyMedium)
                SafetyGate.approvalReason(action)?.let { reason ->
                    Text("Approval checkpoint: $reason", color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        if (!accessibilityEnabled) {
            Text(
                "Android Accessibility is off. Enable it explicitly in Settings to run local actions.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )
            Spacer(Modifier.height(8.dp))
            Button(onClick = onEnableAccessibility, modifier = Modifier.fillMaxWidth()) {
                Text("Enable Accessibility service")
            }
        }
        Button(onClick = onExecute, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text("Review and run locally")
        }
        Spacer(Modifier.height(14.dp))
    }
    HorizontalDivider()
    Spacer(Modifier.height(12.dp))
    Text("The coordinator plans once. Android performs supported actions locally, checks results, and pauses for your approval at sensitive or authentication checkpoints.", style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun HistoryScreen(history: List<String>) {
    if (history.isEmpty()) {
        Text("No verified tasks saved yet.", style = MaterialTheme.typography.bodyLarge)
        return
    }
    history.forEachIndexed { index, task ->
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text("Verified workflow", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text("Saved locally", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
            }
            Spacer(Modifier.height(6.dp))
            Text(task, style = MaterialTheme.typography.bodyLarge)
        }
        if (index < history.lastIndex) HorizontalDivider()
    }
}

@Composable
private fun SettingsScreen(
    projectUrl: String,
    anonKey: String,
    email: String,
    password: String,
    signedIn: Boolean,
    accessibilityEnabled: Boolean,
    feedback: String?,
    onProjectUrlChange: (String) -> Unit,
    onAnonKeyChange: (String) -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSaveProject: () -> Unit,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onRefreshAccessibility: () -> Unit,
) {
    OutlinedTextField(
        value = projectUrl,
        onValueChange = onProjectUrlChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text("Supabase project URL") },
        placeholder = { Text("https://your-project.supabase.co") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
    )
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = anonKey,
        onValueChange = onAnonKeyChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text("Supabase publishable / anon key") },
        visualTransformation = PasswordVisualTransformation(),
    )
    Spacer(Modifier.height(8.dp))
    Button(onClick = onSaveProject, modifier = Modifier.fillMaxWidth()) {
        Text("Save public project settings")
    }
    Spacer(Modifier.height(18.dp))
    HorizontalDivider()
    Spacer(Modifier.height(12.dp))
    Text("Supabase Auth", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = email,
        onValueChange = onEmailChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text("Email") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = password,
        onValueChange = onPasswordChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text("Password") },
        visualTransformation = PasswordVisualTransformation(),
    )
    Spacer(Modifier.height(8.dp))
    Button(onClick = if (signedIn) onSignOut else onSignIn, modifier = Modifier.fillMaxWidth()) {
        Text(if (signedIn) "Sign out" else "Sign in")
    }
    Text(
        if (signedIn) "Signed in for this app session. The access token is held in memory only."
        else "Create/confirm your account in Supabase Auth first. Passwords and sessions are not stored on this device.",
        style = MaterialTheme.typography.bodySmall,
    )
    Spacer(Modifier.height(18.dp))
    HorizontalDivider()
    Spacer(Modifier.height(12.dp))
    Text("Android UI execution", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    Text(
        if (accessibilityEnabled) "Accessibility service enabled by you."
        else "Accessibility service disabled. Enable it only after reviewing the disclosure.",
        style = MaterialTheme.typography.bodyMedium,
    )
    Spacer(Modifier.height(8.dp))
    Button(onClick = onRefreshAccessibility, modifier = Modifier.fillMaxWidth()) {
        Text("Refresh Accessibility status")
    }
    Spacer(Modifier.height(10.dp))
    Text("Five LLM engines, model IDs, timeouts, and bounded retry policies are configured only in Supabase Edge Function secrets. This app does not contain provider credentials.", style = MaterialTheme.typography.bodySmall)
    feedback?.let {
        Spacer(Modifier.height(12.dp))
        Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
    }
}

private fun describeAction(action: ValidatedAction): String =
    listOf(action.type.name, action.target, action.text)
        .filterNotNull()
        .joinToString(" · ")
        .take(180)

private const val MIN_WAIT_MS = 500L
private const val CHECKPOINT_TIMEOUT_MS = 5 * 60 * 1000L
