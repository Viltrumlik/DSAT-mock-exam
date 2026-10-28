import SwiftUI
import MasterSATKit

/// "Open the class page for this subject at this level" — what a level card pushes on the Class
/// stack. A value route, declared at the Class root beside `AppLink`, so the push never drops.
struct ClassPageRoute: Hashable {
    let subject: ClassSubject
    /// The roadmap level's key, as the server names it (`junior`, `middle`, …).
    let level: String
}
