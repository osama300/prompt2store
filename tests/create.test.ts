import { describe, it, expect } from "vitest";
import { setAndroidApplicationId, setIosBundleId, setAndroidLabel, setIosDisplayName } from "../src/mcp/tools/create.js";

describe("app_create helpers", () => {
  it("sets applicationId in Kotlin DSL and Groovy", () => {
    expect(setAndroidApplicationId('applicationId = "com.a.shopping_list"', "com.a.shop")).toBe('applicationId = "com.a.shop"');
    expect(setAndroidApplicationId('applicationId "com.a.shopping_list"', "com.a.shop")).toBe('applicationId "com.a.shop"');
  });
  it("sets iOS bundle ids for Runner and RunnerTests", () => {
    const pbx = "PRODUCT_BUNDLE_IDENTIFIER = com.a.shoppingList;\nPRODUCT_BUNDLE_IDENTIFIER = com.a.shoppingList.RunnerTests;\n";
    expect(setIosBundleId(pbx, "com.a.shop")).toBe("PRODUCT_BUNDLE_IDENTIFIER = com.a.shop;\nPRODUCT_BUNDLE_IDENTIFIER = com.a.shop.RunnerTests;\n");
  });
  it("sets display names with XML escaping, Arabic included", () => {
    expect(setAndroidLabel('<application android:label="x" />', 'Tom & "Jerry"')).toBe('<application android:label="Tom &amp; &quot;Jerry&quot;" />');
    expect(setIosDisplayName("<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>X</string>", "قائمة")).toContain("<string>قائمة</string>");
    expect(setIosDisplayName("<plist><dict>\n</dict>", "قائمة")).toContain("<key>CFBundleDisplayName</key>\n\t<string>قائمة</string>");
  });
});
