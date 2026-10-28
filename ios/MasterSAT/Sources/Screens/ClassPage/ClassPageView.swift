import SwiftUI
import MasterSATKit

/// The class page: one subject at one level, its sessions as a trail. (Placeholder — replaced by
/// the real page in the same change.)
struct ClassPageView: View {
    let route: ClassPageRoute

    var body: some View {
        Text("\(route.subject.rawValue) · \(route.level)")
    }
}
