// Throwaway test for Phase 7: can a small native app, delivered by `git pull`,
// open on the work Mac and show Mindscape? It only shows the page from the
// local server; it doesn't start anything, change settings, or touch the vault.
import Cocoa
import WebKit

/// The port from Mindscape's machine settings, or the default.
func mindscapeURL() -> URL {
    var port = 4317
    let settings = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Mindscape/settings.json")
    if let data = try? Data(contentsOf: settings),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let p = json["port"] as? Int {
        port = p
    }
    return URL(string: "http://127.0.0.1:\(port)/")!
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    let url = mindscapeURL()

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        web.navigationDelegate = self
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Mindscape (test app)"
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("HelloMindscape")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        load()
    }

    @objc func load() {
        web.load(URLRequest(url: url))
    }

    func showProblem(_ detail: String) {
        let html = """
        <body style="font: 15px -apple-system; color: #333; padding: 48px; max-width: 560px">
        <h2>The test app opened. 🎉</h2>
        <p>It couldn't reach Mindscape at \(url.absoluteString), though.
        Double-click <b>Mindscape.command</b> to start it, then press <b>⌘R</b> here.</p>
        <p style="color: #888; font-size: 12px">\(detail)</p>
        </body>
        """
        web.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
        showProblem(e.localizedDescription)
    }

    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) {
        showProblem(e.localizedDescription)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    /// App, Edit (so copy and paste work in the page), and View (Reload) menus.
    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem()
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            item.submenu = menu
            main.addItem(item)
        }
        add("Mindscape", [
            NSMenuItem(title: "Hide", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"),
            NSMenuItem(title: "Quit Test App", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"),
        ])
        add("Edit", [
            NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"),
            NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"),
            NSMenuItem.separator(),
            NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
            NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
            NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
            NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
        ])
        let reload = NSMenuItem(title: "Reload", action: #selector(load), keyEquivalent: "r")
        reload.target = self
        add("View", [reload])
        add("Window", [
            NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"),
            NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"),
        ])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
