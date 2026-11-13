package il.salzol.go

import android.app.Application
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import il.salzol.core.droid.Droid
import il.salzol.core.droid.Listener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Opens the Go engine once per process and schedules the daily refresh. */
class SalzolApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Droid.open(filesDir.absolutePath)
        Droid.setListener(object : Listener {
            override fun onEvent(eventJSON: String) = Bus.event(eventJSON)
        })
        Droid.startAI()
        val work = PeriodicWorkRequestBuilder<RefreshWorker>(12, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build())
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("salzol-refresh", ExistingPeriodicWorkPolicy.KEEP, work)
    }
}

/** Background events from Go reach the screens as a counter (re-read your data) and the last message. */
object Bus {
    private val _tick = MutableStateFlow(0)
    val tick: StateFlow<Int> = _tick
    private val _msg = MutableStateFlow("")
    val msg: StateFlow<String> = _msg
    private val _type = MutableStateFlow("")
    val type: StateFlow<String> = _type

    fun event(json: String) {
        val o = runCatching { JSONObject(json) }.getOrNull() ?: return
        _type.value = o.optString("type")
        _msg.value = o.optString("msg")
        _tick.value = _tick.value + 1
    }

    fun poke() { _tick.value = _tick.value + 1 }
}

/** The daily refresh: the Go engine syncs the saved place, then runs the AI delta. */
class RefreshWorker(ctx: android.content.Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Droid.open(applicationContext.filesDir.absolutePath)
        val err = Droid.refreshNow(8 * 60)
        if (err.isEmpty()) Result.success() else Result.retry()
    }
}
