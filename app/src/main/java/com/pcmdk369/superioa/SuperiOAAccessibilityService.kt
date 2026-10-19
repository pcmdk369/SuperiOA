package com.pcmdk369.superioa

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.pcmdk369.superioa.core.ActionType
import com.pcmdk369.superioa.core.ValidatedAction
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

sealed interface ActionExecution {
    data object Success : ActionExecution
    data class Failed(val reason: String) : ActionExecution
    data class NeedsUser(val reason: String) : ActionExecution
    data object Cancelled : ActionExecution
}

class SuperiOAAccessibilityService : AccessibilityService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val cancellationRequested = AtomicBoolean(false)

    override fun onServiceConnected() {
        super.onServiceConnected()
        active = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() {
        active = null
    }

    override fun onDestroy() {
        if (active === this) active = null
        super.onDestroy()
    }

    fun safeUiSnapshot(maxLength: Int = MAX_SNAPSHOT_LENGTH): String? {
        val root = rootInActiveWindow ?: return null
        if (securityCheckpoint(root)) return null
        val result = StringBuilder()
        appendAccessibleText(root, result, maxLength)
        return result.toString().takeIf(String::isNotBlank)
    }

    fun currentPackage(): String? = rootInActiveWindow?.packageName?.toString()

    fun resetCancellation() {
        cancellationRequested.set(false)
    }

    fun cancelActions() {
        cancellationRequested.set(true)
    }

    fun execute(action: ValidatedAction): ActionExecution {
        if (cancellationRequested.get()) return ActionExecution.Cancelled
        if (Looper.myLooper() == Looper.getMainLooper()) return executeOnMainThread(action)
        val finished = CountDownLatch(1)
        var result: ActionExecution = ActionExecution.Failed("Accessibility action did not complete.")
        mainHandler.post {
            result = if (cancellationRequested.get()) {
                ActionExecution.Cancelled
            } else {
                executeOnMainThread(action)
            }
            finished.countDown()
        }
        return try {
            if (!finished.await(action.timeoutMs.toLong() + ACTION_DISPATCH_ALLOWANCE_MS, TimeUnit.MILLISECONDS)) {
                ActionExecution.Failed("Accessibility action timed out.")
            } else {
                result
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            ActionExecution.Cancelled
        }
    }

    private fun executeOnMainThread(action: ValidatedAction): ActionExecution {
        if (Thread.currentThread().isInterrupted || cancellationRequested.get()) return ActionExecution.Cancelled
        val root = rootInActiveWindow
        if (root != null && securityCheckpoint(root)) {
            return ActionExecution.NeedsUser("Complete the authentication or security checkpoint on your device, then resume.")
        }

        return when (action.type) {
            ActionType.OPEN_APP -> openApp(action.target.orEmpty())
            ActionType.OPEN_URL -> openUrl(action.target.orEmpty())
            ActionType.BACK -> globalAction(GLOBAL_ACTION_BACK)
            ActionType.HOME -> globalAction(GLOBAL_ACTION_HOME)
            ActionType.RECENTS -> globalAction(GLOBAL_ACTION_RECENTS)
            ActionType.TAP -> tap(root, action.target.orEmpty())
            ActionType.TYPE -> typeText(root, action.target.orEmpty(), action.text.orEmpty())
            ActionType.SCROLL -> scroll(root, action.target.orEmpty())
            ActionType.SWIPE -> swipe(action.target.orEmpty())
            ActionType.COPY -> focusedAction(root, AccessibilityNodeInfo.ACTION_COPY)
            ActionType.PASTE -> focusedAction(root, AccessibilityNodeInfo.ACTION_PASTE)
            ActionType.READ_UI -> if (root == null) {
                ActionExecution.Failed("There is no accessible active window.")
            } else {
                ActionExecution.Success
            }
            ActionType.WAIT -> ActionExecution.Success
            ActionType.VERIFY -> verify(root, action.target.orEmpty())
            ActionType.RETRY -> ActionExecution.Failed("Replanning is required before retrying.")
            ActionType.ABORT -> ActionExecution.Cancelled
            ActionType.REQUEST_USER -> ActionExecution.NeedsUser(action.text.orEmpty())
        }
    }

    private fun openApp(label: String): ActionExecution {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val match = packageManager.queryIntentActivities(launcher, 0)
            .firstOrNull { it.loadLabel(packageManager).toString().equals(label, ignoreCase = true) }
            ?: packageManager.queryIntentActivities(launcher, 0)
                .firstOrNull { it.loadLabel(packageManager).toString().contains(label, ignoreCase = true) }
        val packageName = match?.activityInfo?.packageName
            ?: return ActionExecution.Failed("The requested app is not available to launch.")
        val intent = packageManager.getLaunchIntentForPackage(packageName)
            ?: return ActionExecution.Failed("Android did not provide a launch intent for that app.")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        return ActionExecution.Success
    }

    private fun openUrl(address: String): ActionExecution {
        if (!address.matches(Regex("""https://[^/?#]+(?:[/?#]|$)""", RegexOption.IGNORE_CASE))) {
            return ActionExecution.Failed("Only valid HTTPS URLs without embedded credentials can be opened.")
        }
        val uri = Uri.parse(address)
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank() || uri.userInfo != null) {
            return ActionExecution.Failed("Only valid HTTPS URLs without embedded credentials can be opened.")
        }
        val intent = Intent(Intent.ACTION_VIEW, uri)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            if (intent.resolveActivity(packageManager) == null) {
                ActionExecution.Failed("No browser is available to open the requested URL.")
            } else {
                startActivity(intent)
                ActionExecution.Success
            }
        } catch (_: ActivityNotFoundException) {
            ActionExecution.Failed("No browser is available to open the requested URL.")
        }
    }

    private fun globalAction(action: Int): ActionExecution =
        if (performGlobalAction(action)) ActionExecution.Success
        else ActionExecution.Failed("Android did not perform the requested navigation action.")

    private fun tap(root: AccessibilityNodeInfo?, target: String): ActionExecution {
        val node = root?.let { findTarget(it, target) }
            ?: return ActionExecution.Failed("The target is not visible in the accessible UI.")
        var clickable: AccessibilityNodeInfo? = node
        while (clickable != null && !clickable.isClickable) clickable = clickable.parent
        return if (clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) {
            ActionExecution.Success
        } else {
            ActionExecution.Failed("The visible target cannot be clicked through Accessibility.")
        }
    }

    private fun typeText(root: AccessibilityNodeInfo?, target: String, text: String): ActionExecution {
        if (SECURITY_CHECKPOINT.containsMatchIn(target)) {
            return ActionExecution.NeedsUser("Enter passwords, codes, and security challenges yourself.")
        }
        val node = root?.let { findTarget(it, target) }
            ?: return ActionExecution.Failed("The text field is not visible in the accessible UI.")
        if (!node.isEditable) return ActionExecution.Failed("The selected UI target is not an editable text field.")
        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) {
            ActionExecution.Success
        } else {
            ActionExecution.Failed("The target application rejected text entry.")
        }
    }

    private fun scroll(root: AccessibilityNodeInfo?, target: String): ActionExecution {
        val direction = target.lowercase()
        val action = if (direction.contains("up") || direction.contains("back")) {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }
        val node = if (direction in setOf("up", "down", "forward", "backward")) root else root?.let { findTarget(it, target) }
        val scrollable = node?.let(::findScrollable)
            ?: return ActionExecution.Failed("No accessible scrollable element is available.")
        return if (scrollable.performAction(action)) ActionExecution.Success
        else ActionExecution.Failed("The scroll action was rejected by the target app.")
    }

    private fun swipe(direction: String): ActionExecution {
        val (startX, startY, endX, endY) = when (direction.lowercase()) {
            "up" -> listOf(0.5f, 0.8f, 0.5f, 0.2f)
            "down" -> listOf(0.5f, 0.2f, 0.5f, 0.8f)
            "left" -> listOf(0.85f, 0.5f, 0.15f, 0.5f)
            "right" -> listOf(0.15f, 0.5f, 0.85f, 0.5f)
            else -> return ActionExecution.Failed("Swipe direction must be up, down, left, or right.")
        }
        val metrics = resources.displayMetrics
        val path = Path().apply {
            moveTo(startX * metrics.widthPixels, startY * metrics.heightPixels)
            lineTo(endX * metrics.widthPixels, endY * metrics.heightPixels)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 300))
            .build()
        return if (dispatchGesture(gesture, null, null)) ActionExecution.Success
        else ActionExecution.Failed("Android rejected the requested gesture.")
    }

    private fun focusedAction(root: AccessibilityNodeInfo?, action: Int): ActionExecution {
        val focused = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: return ActionExecution.Failed("There is no focused UI element for this action.")
        return if (focused.performAction(action)) ActionExecution.Success
        else ActionExecution.Failed("The focused UI element rejected the clipboard action.")
    }

    private fun verify(root: AccessibilityNodeInfo?, expected: String): ActionExecution {
        if (root == null) return ActionExecution.Failed("There is no accessible active window to verify.")
        val snapshot = StringBuilder()
        appendAccessibleText(root, snapshot, MAX_SNAPSHOT_LENGTH)
        return if (snapshot.contains(expected, ignoreCase = true)) ActionExecution.Success
        else ActionExecution.Failed("The expected result is not visible yet.")
    }

    private fun findTarget(root: AccessibilityNodeInfo, target: String): AccessibilityNodeInfo? {
        if (matches(root, target)) return root
        for (index in 0 until root.childCount) {
            val child = root.getChild(index) ?: continue
            findTarget(child, target)?.let { return it }
        }
        return null
    }

    private fun matches(node: AccessibilityNodeInfo, target: String): Boolean {
        val query = target.trim()
        if (query.isEmpty()) return false
        return listOfNotNull(node.text?.toString(), node.contentDescription?.toString(), node.hintText?.toString(), node.viewIdResourceName)
            .any { it.contains(query, ignoreCase = true) }
    }

    private fun findScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isScrollable) return node
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            findScrollable(child)?.let { return it }
        }
        return null
    }

    private fun securityCheckpoint(root: AccessibilityNodeInfo): Boolean {
        val snapshot = StringBuilder()
        appendAccessibleText(root, snapshot, MAX_SNAPSHOT_LENGTH)
        return SECURITY_CHECKPOINT.containsMatchIn(snapshot)
    }

    private fun appendAccessibleText(node: AccessibilityNodeInfo, output: StringBuilder, maxLength: Int) {
        if (output.length >= maxLength) return
        val visibleLabels = when {
            node.isPassword -> listOfNotNull(node.hintText?.toString(), node.viewIdResourceName)
            node.isEditable -> listOfNotNull(node.hintText?.toString(), node.viewIdResourceName)
            else -> listOfNotNull(
                node.text?.toString(),
                node.contentDescription?.toString(),
                node.hintText?.toString(),
                node.viewIdResourceName,
            )
        }
        visibleLabels.filter(String::isNotBlank).forEach { value ->
            if (output.length < maxLength) output.append(value.take(maxLength - output.length)).append(' ')
        }
        for (index in 0 until node.childCount) {
            if (output.length >= maxLength) return
            node.getChild(index)?.let { appendAccessibleText(it, output, maxLength) }
        }
    }

    companion object {
        const val MAX_SNAPSHOT_LENGTH = 8_000
        const val ACTION_DISPATCH_ALLOWANCE_MS = 1_000L
        val SECURITY_CHECKPOINT = Regex(
            """\b(password|passcode|one[- ]time code|otp|captcha|biometric|fingerprint|face authentication|security code)\b""",
            RegexOption.IGNORE_CASE,
        )

        @Volatile
        var active: SuperiOAAccessibilityService? = null
            private set

        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ).orEmpty()
            val component = "${context.packageName}/${SuperiOAAccessibilityService::class.java.name}"
            return enabled.split(':').any { it.equals(component, ignoreCase = true) }
        }
    }
}
