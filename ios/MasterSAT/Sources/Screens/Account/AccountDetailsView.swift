import SwiftUI
import PhotosUI
import MasterSATKit

/// Settings › Account: the photo, the name, the username and the phone — how teachers and
/// classmates see the student. The web's `AccountSection`.
///
/// The photo saves the moment it is chosen; the four text fields save together. Email is not
/// here: it changes only by confirming a code, in Sign-in & password.
struct AccountDetailsView: View {
    @Environment(Session.self) private var session

    @State private var load: AccountLoadState<AccountProfile> = .loading
    @State private var saved = AccountDetailsDraft()
    @State private var draft = AccountDetailsDraft()
    @State private var fieldErrors: [AccountField: String] = [:]
    @State private var generalError: String?
    @State private var isSaving = false
    @State private var photoBusy = false
    @State private var photoItem: PhotosPickerItem?
    @State private var toast: RewardsToastMessage?
    @FocusState private var focus: AccountField?

    private var account: AccountAPI { AccountAPI(client: session.client) }
    private var isDirty: Bool { draft.isDirty(comparedTo: saved) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AccountPageHeading(title: "Account", description: "How your teachers and classmates see you.")

                switch load {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
                case .failed(let message):
                    RetryNotice(message: message) { await reload() }
                        .cardStyle()
                case .loaded(let profile):
                    photoCard(profile)
                    detailsCard
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focus = nil }
            }
        }
        .task {
            // Once: coming back to this page must not overwrite what is being typed.
            if load.isLoading { await reload() }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await upload(item) }
        }
        .rewardsToast($toast)
    }

    // MARK: Photo

    private func photoCard(_ profile: AccountProfile) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                AccountAvatar(url: profile.profileImageURL, name: profile.displayName, size: 72)
                    .overlay {
                        if photoBusy {
                            RoundedRectangle(cornerRadius: 72 * 0.28, style: .continuous)
                                .fill(.black.opacity(0.35))
                                .overlay(ProgressView().tint(.white))
                        }
                    }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Profile photo")
                        .font(.system(size: 15, weight: .heavy))
                    Text("A clear photo of your face. JPG or PNG, up to 5 MB.")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label(profile.hasPhoto ? "Change photo" : "Upload photo", systemImage: "camera")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .soft, tone: Theme.accent))
                .disabled(photoBusy)

                if profile.hasPhoto {
                    Button {
                        Task { await removePhoto() }
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                    .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: Theme.danger))
                    .disabled(photoBusy)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.accentSoft))
    }

    // MARK: Details

    private var detailsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            AccountTextField(
                label: AccountField.firstName.label,
                text: binding(.firstName),
                error: fieldErrors[.firstName],
                contentType: .givenName,
                focus: $focus,
                field: AccountField.firstName,
                onSubmit: { focus = .lastName }
            )
            AccountTextField(
                label: AccountField.lastName.label,
                text: binding(.lastName),
                error: fieldErrors[.lastName],
                contentType: .familyName,
                focus: $focus,
                field: AccountField.lastName,
                onSubmit: { focus = .username }
            )
            AccountTextField(
                label: AccountField.username.label,
                icon: "at",
                text: binding(.username),
                hint: "At least 3 characters. Classmates find you by it.",
                error: fieldErrors[.username],
                contentType: .username,
                capitalization: .never,
                focus: $focus,
                field: AccountField.username,
                onSubmit: { focus = .phoneNumber }
            )
            AccountTextField(
                label: AccountField.phoneNumber.label,
                icon: "phone",
                text: binding(.phoneNumber),
                prompt: "+998 90 123 45 67",
                hint: "Optional. So your learning center can reach you.",
                error: fieldErrors[.phoneNumber],
                contentType: .telephoneNumber,
                keyboard: .phonePad,
                capitalization: .never,
                submitLabel: .done,
                focus: $focus,
                field: AccountField.phoneNumber
            )

            if let generalError {
                Text(generalError)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            HStack(spacing: 10) {
                Button {
                    Task { await save() }
                } label: {
                    Text(isSaving ? "Saving…" : "Save changes")
                }
                .buttonStyle(AccountPillButtonStyle(kind: .solid, tone: Theme.accent))
                .disabled(!isDirty || isSaving)

                if isDirty {
                    Button("Undo") {
                        draft = saved
                        fieldErrors = [:]
                        generalError = nil
                    }
                    .buttonStyle(AccountPillButtonStyle(kind: .quiet, tone: Theme.accent))
                    .disabled(isSaving)
                } else {
                    Text("Everything here is saved.")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }
        }
        .cardStyle(padding: 18)
    }

    /// Typing into a field clears the refusal under it, as on the web.
    private func binding(_ field: AccountField) -> Binding<String> {
        Binding(
            get: { draft.value(field) },
            set: {
                draft.set(field, $0)
                fieldErrors[field] = nil
            }
        )
    }

    // MARK: Loading and saving

    private func reload() async {
        load = .loading
        do {
            apply(try await account.profile(), replacingDraft: true)
        } catch {
            load = .failed("Your details didn't load. Nothing has changed — try again.")
        }
    }

    /// Take a fresh profile from the server. The typed text survives a save made elsewhere
    /// (the photo), exactly as on the web, unless it is being replaced on purpose.
    private func apply(_ profile: AccountProfile, replacingDraft: Bool) {
        let keepTyping = !replacingDraft && isDirty
        saved = AccountDetailsDraft(profile)
        if !keepTyping { draft = saved }
        load = .loaded(profile)
    }

    private func save() async {
        guard isDirty, !isSaving else { return }
        focus = nil
        let problems = draft.problems(since: saved)
        guard problems.isEmpty else {
            fieldErrors = problems
            generalError = nil
            return
        }
        isSaving = true
        fieldErrors = [:]
        generalError = nil
        defer { isSaving = false }
        do {
            let profile = try await account.updateDetails(draft.changes(since: saved))
            apply(profile, replacingDraft: true)
            toast = .accountSuccess(AccountCopy.detailsSaved)
            // The name on Profile, Home and the completion gate all read the session's copy.
            await session.refreshUser()
        } catch {
            let failure = AccountCopy.detailsFailure(error)
            if AccountCopy.fieldMessages(error) == nil {
                toast = .accountNotice(failure.general ?? AccountCopy.detailsFailed)
            } else {
                fieldErrors = failure.fields
                generalError = failure.general
            }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        guard !photoBusy else { return }
        photoBusy = true
        defer { photoBusy = false }
        guard let original = try? await item.loadTransferable(type: Data.self) else {
            toast = .accountNotice(AccountCopy.photoFailed)
            return
        }
        // HEIC becomes JPEG (the server cannot open HEIC and would store a photo that never
        // draws), and a camera JPEG is re-encoded so its EXIF — location included — stays on
        // the phone. Off the main actor: a 48-megapixel decode would stall the spinner.
        let (data, kind) = await Task.detached(priority: .userInitiated) {
            PhotoUpload.prepare(original)
        }.value
        if let problem = ProfilePhotoRules.problem(byteCount: data.count, mimeType: kind.mimeType) {
            toast = .accountNotice(problem)
            return
        }
        do {
            let profile = try await account.uploadPhoto(data, fileExtension: kind.extension, mimeType: kind.mimeType)
            apply(profile, replacingDraft: false)
            toast = .accountSuccess(AccountCopy.photoUploaded)
            await session.refreshUser()
        } catch {
            toast = .accountNotice(AccountCopy.photoFailure(error))
        }
    }

    private func removePhoto() async {
        guard !photoBusy else { return }
        photoBusy = true
        defer { photoBusy = false }
        do {
            let profile = try await account.removePhoto()
            apply(profile, replacingDraft: false)
            toast = .accountSuccess(AccountCopy.photoRemoved)
            await session.refreshUser()
        } catch {
            toast = .accountNotice(AccountCopy.photoRemoveFailed)
        }
    }
}
