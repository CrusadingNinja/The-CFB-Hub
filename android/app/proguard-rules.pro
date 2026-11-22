# Keep JavaScript bridge methods exposed to WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
