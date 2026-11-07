package app.duolicious.selectabletext

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext

class SelectableTextPackage : ReactPackage {
  override fun createViewManagers(reactContext: ReactApplicationContext) =
    listOf(SelectableTextViewManager())
}
