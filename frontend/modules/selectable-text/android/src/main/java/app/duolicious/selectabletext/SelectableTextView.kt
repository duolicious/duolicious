package app.duolicious.selectabletext

import android.content.Context
import android.graphics.Paint
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event

class SelectableTextView(context: Context) : TextView(context) {
  init {
    paintFlags = paintFlags or Paint.SUBPIXEL_TEXT_FLAG or Paint.LINEAR_TEXT_FLAG
    includeFontPadding = false
    setTextIsSelectable(true)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    setTextIsSelectable(false)
    setTextIsSelectable(true)
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    if (!isAttachedToWindow) return
    UIManagerHelper.getEventDispatcherForReactTag(context as ReactContext, id)
      ?.dispatchEvent(
        SelectionChangeEvent(UIManagerHelper.getSurfaceId(this), id, selStart, selEnd),
      )
  }
}

private class SelectionChangeEvent(
  surfaceId: Int,
  viewTag: Int,
  private val start: Int,
  private val end: Int,
) : Event<SelectionChangeEvent>(surfaceId, viewTag) {
  override fun getEventName() = "topSelectionChange"

  override fun getEventData() = Arguments.createMap().apply {
    putInt("start", start)
    putInt("end", end)
  }
}
