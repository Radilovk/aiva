# ProGuard rules for AIVA APK
-keep class com.aiva.assistant.** { *; }
-keep class com.capacitorjs.plugins.localnotifications.AivaNotificationReceiver { *; }
-keep class com.getcapacitor.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-dontwarn com.getcapacitor.**
