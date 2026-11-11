import ApplicationServices
import Foundation
let application=AXUIElementCreateApplication(pid_t(CommandLine.arguments[1])!)
var values:[Any]=[]
for key in ["AXManualAccessibility","AXEnhancedUserInterface"] {
 var value:CFTypeRef?
 if AXUIElementCopyAttributeValue(application,key as CFString,&value) == .success,let value=value,CFGetTypeID(value)==CFBooleanGetTypeID(){values.append(CFBooleanGetValue((value as! CFBoolean)))}else{values.append(NSNull())}
}
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject:values))
