package app.duolicious.selectabletext

import android.content.Context
import android.graphics.Typeface
import android.util.TypedValue
import android.view.View.MeasureSpec
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.viewmanagers.DuoSelectableTextManagerDelegate
import com.facebook.react.viewmanagers.DuoSelectableTextManagerInterface
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import kotlin.math.ceil

class SelectableTextViewManager :
  SimpleViewManager<SelectableTextView>(),
  DuoSelectableTextManagerInterface<SelectableTextView> {
  private val delegate = DuoSelectableTextManagerDelegate(this)

  override fun getDelegate() = delegate

  override fun getName() = "DuoSelectableText"

  override fun createViewInstance(context: ThemedReactContext) = SelectableTextView(context)

  override fun setText(view: SelectableTextView, value: String?) {
    view.text = value
  }

  override fun setColor(view: SelectableTextView, value: Int?) {
    value?.let(view::setTextColor)
  }

  override fun setFontFamily(view: SelectableTextView, value: String?) {
    view.typeface = value?.let {
      ReactFontManager.getInstance().getTypeface(it, Typeface.NORMAL, view.context.assets)
    }
  }

  override fun setFontSize(view: SelectableTextView, value: Float) {
    view.setTextSize(TypedValue.COMPLEX_UNIT_PX, ceil(PixelUtil.toPixelFromSP(value)))
  }

  override fun measure(
    context: Context,
    localData: ReadableMap?,
    props: ReadableMap,
    state: ReadableMap?,
    width: Float,
    widthMode: YogaMeasureMode,
    height: Float,
    heightMode: YogaMeasureMode,
    attachmentsPositions: FloatArray?,
  ): Long {
    val view = SelectableTextView(context)
    updateProperties(view, ReactStylesDiffMap(props))
    view.measure(
      MeasureSpec.makeMeasureSpec(
        width.toInt(),
        when (widthMode) {
          YogaMeasureMode.EXACTLY -> MeasureSpec.EXACTLY
          YogaMeasureMode.AT_MOST -> MeasureSpec.AT_MOST
          YogaMeasureMode.UNDEFINED -> MeasureSpec.UNSPECIFIED
        },
      ),
      MeasureSpec.UNSPECIFIED,
    )
    return YogaMeasureOutput.make(
      PixelUtil.toDIPFromPixel(view.measuredWidth.toFloat()),
      PixelUtil.toDIPFromPixel(view.measuredHeight.toFloat()),
    )
  }
}
