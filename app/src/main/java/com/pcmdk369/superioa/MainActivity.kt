package com.pcmdk369.superioa

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONArray

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { SuperiOAApp() }
    }
}

private enum class AppTab(val label: String) {
    RUN("Run"), HISTORY("History"), SETTINGS("Settings")
}

@Composable
private fun SuperiOAApp() {
    val context = LocalContext.current
    val preferences = remember { context.getSharedPreferences("superioa", 0) }
    val history = remember {
        mutableStateListOf<String>().apply {
            val saved = runCatching { JSONArray(preferences.getString("history", "[]")) }.getOrNull()
            if (saved != null) repeat(saved.length()) { index -> add(saved.optString(index)) }
        }
    }
    var selectedTab by rememberSaveable { mutableStateOf(AppTab.RUN) }
    var taskText by rememberSaveable { mutableStateOf("") }
    var feedback by rememberSaveable { mutableStateOf<String?>(null) }

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
                Text("SUPERIOA  /  TASK DESK", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(8.dp))
                Text(
                    when (selectedTab) {
                        AppTab.RUN -> "What should I take care of?"
                        AppTab.HISTORY -> "Task history"
                        AppTab.SETTINGS -> "System status"
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
                        onSaveTask = {
                            val task = taskText.trim()
                            if (task.isNotEmpty()) {
                                history.add(0, task)
                                val stored = JSONArray().apply { history.take(50).forEach(::put) }
                                preferences.edit().putString("history", stored.toString()).apply()
                                taskText = ""
                                feedback = "Saved on this device. No actions were executed."
                            }
                        },
                    )
                    AppTab.HISTORY -> HistoryScreen(history)
                    AppTab.SETTINGS -> SettingsScreen()
                }
            }
        }
    }
}

@Composable
private fun RunScreen(
    taskText: String,
    onTaskTextChange: (String) -> Unit,
    feedback: String?,
    onSaveTask: () -> Unit,
) {
    OutlinedTextField(
        value = taskText,
        onValueChange = onTaskTextChange,
        modifier = Modifier.fillMaxWidth(),
        minLines = 4,
        label = { Text("Describe a task") },
        placeholder = { Text("Example: Open Chrome and find the latest project updates") },
    )
    Spacer(Modifier.height(12.dp))
    Button(onClick = onSaveTask, enabled = taskText.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
        Text("  Save task locally")
    }
    Spacer(Modifier.height(20.dp))
    feedback?.let {
        Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(16.dp))
    }
    HorizontalDivider()
    Spacer(Modifier.height(16.dp))
    Text("Execution is paused", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(6.dp))
    Text(
        "No planning provider or Android action service is configured. Tasks are stored locally for now; SuperiOA will not claim or perform actions until those integrations are implemented and enabled.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
    )
}

@Composable
private fun HistoryScreen(history: List<String>) {
    if (history.isEmpty()) {
        Text("No saved tasks yet.", style = MaterialTheme.typography.bodyLarge)
        return
    }
    history.forEachIndexed { index, task ->
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text("Saved task", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text("Local draft", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
            }
            Spacer(Modifier.height(6.dp))
            Text(task, style = MaterialTheme.typography.bodyLarge)
        }
        if (index < history.lastIndex) HorizontalDivider()
    }
}

@Composable
private fun SettingsScreen() {
    val rows = listOf(
        "Task storage" to "On device",
        "Planner endpoint" to "Not configured",
        "Five-engine failover" to "Core contract ready; providers not connected",
        "Accessibility action service" to "Not implemented",
        "Supabase sync" to "Not configured",
        "Voice input and output" to "Not configured",
    )
    rows.forEachIndexed { index, (label, value) ->
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
            Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(3.dp))
            Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f))
        }
        if (index < rows.lastIndex) HorizontalDivider()
    }
    Spacer(Modifier.height(18.dp))
    Surface(color = Color(0xFFE8EFE8), shape = MaterialTheme.shapes.small) {
        Text(
            "Provider secrets must stay on a trusted backend. Do not put API keys in the APK or source control.",
            modifier = Modifier.padding(14.dp),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}