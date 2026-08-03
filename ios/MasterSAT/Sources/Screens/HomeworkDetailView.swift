import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import MasterSATKit

/// One homework: what was asked, what has been handed in, and how to hand more in.
///
/// On a phone the dominant case is "photograph the work I did on paper", so the photo
/// picker leads and the file browser sits behind it.
struct HomeworkDetailView: View {
    let assignment: AssignmentListing

    @Environment(Session.self) private var session
    @State private var submission: Submission?
    @State private var loadError: String?
    @State private var isLoading = true

    /// Files chosen but not yet uploaded. They keep their token from the moment they are
    /// picked, so a retry after a failure re-sends the same identity and the server
    /// deduplicates instead of storing two copies.
    @State private var staged: [MultipartForm.File] = []
    @State private var photoSelections: [PhotosPickerItem] = []
    @State private var isImportingFile = false
    @State private var isUploading = false
    @State private var actionError: String?

    private var classroomId: Int? { assignment.classroomId }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if classroomId == nil {
                ContentUnavailableView(
                    "This homework has no classroom",
                    systemImage: "questionmark.folder",
                    description: Text("Ask your teacher — it cannot be submitted from here.")
                )
            } else {
                content
            }
        }
        .navigationTitle("Homework")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var content: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(assignment.title).font(.headline)
                    if let instructions = assignment.instructions, !instructions.isEmpty {
                        RichText(html: instructions)
                    }
                    HStack(spacing: 8) {
                        Text(StatusLabel.homework(submission?.workflowStatus ?? assignment.workflowStatus))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(StatusLabel.color(submission?.workflowStatus ?? assignment.workflowStatus))
                        if let due = assignment.dueAt, let date = JSONCoding.parseServerDate(due) {
                            Text("· Due \(date.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption)
                                .foregroundStyle(assignment.isOverdue ? .orange : .secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
            }

            if let note = submission?.returnNote, !note.isEmpty {
                Section("From your teacher") {
                    // A returned homework is an invitation to revise, so the note leads.
                    Text(note).font(.subheadline)
                }
            }

            if let files = submission?.files, !files.isEmpty {
                Section("Handed in") {
                    ForEach(files) { file in
                        SubmittedFileRow(file: file) { await remove(file) }
                    }
                }
            }

            if !staged.isEmpty {
                Section("Ready to send") {
                    ForEach(Array(staged.enumerated()), id: \.element.token) { index, file in
                        HStack(spacing: 10) {
                            Image(systemName: "doc").foregroundStyle(Theme.accent)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(file.filename).font(.subheadline)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(file.data.count), countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button {
                                staged.remove(at: index)
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            Section {
                PhotosPicker(selection: $photoSelections, matching: .images) {
                    Label("Add photos", systemImage: "camera")
                }
                Button {
                    isImportingFile = true
                } label: {
                    Label("Add a file", systemImage: "doc.badge.plus")
                }

                Button(action: submit) {
                    if isUploading {
                        HStack { ProgressView().controlSize(.small); Text("Sending…") }
                    } else {
                        Label(submission?.hasBeenSubmitted == true ? "Send again" : "Hand in", systemImage: "paperplane")
                            .fontWeight(.semibold)
                    }
                }
                .disabled(isUploading || (staged.isEmpty && submission?.files.isEmpty != false))
            } footer: {
                if let actionError {
                    Text(actionError).foregroundStyle(.red)
                } else if staged.isEmpty && submission?.files.isEmpty != false {
                    Text("Add a photo of your work, or a file, then hand it in.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .onChange(of: photoSelections) { _, items in
            Task { await stagePhotos(items) }
        }
        .fileImporter(
            isPresented: $isImportingFile,
            allowedContentTypes: [.pdf, .image, .plainText, .rtf, .presentation, .spreadsheet, .content],
            allowsMultipleSelection: true
        ) { result in
            Task { await stageFiles(result) }
        }
    }

    // MARK: - Staging

    @MainActor
    private func stagePhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        for (offset, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            // Camera roll items have no useful filename, so name them for the teacher who
            // will open them: a list of "image.jpg" is unreadable. The extension comes from
            // the bytes, not a guess — a screenshot is a PNG and a recent iPhone photo may
            // be HEIC, and the server validates uploads by extension.
            let kind = MultipartForm.imageKind(for: data)
            let stamp = Int(Date().timeIntervalSince1970)
            staged.append(MultipartForm.File(
                filename: "photo-\(stamp)-\(offset + 1).\(kind.extension)",
                mimeType: kind.mimeType,
                data: data
            ))
        }
        photoSelections = []
    }

    @MainActor
    private func stageFiles(_ result: Result<[URL], Error>) async {
        switch result {
        case .success(let urls):
            for url in urls {
                // A file picked from iCloud or another app is outside the sandbox until
                // access is opened, and it must be closed again or the grant leaks.
                let opened = url.startAccessingSecurityScopedResource()
                defer { if opened { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else {
                    actionError = "Could not read \(url.lastPathComponent)."
                    continue
                }
                staged.append(MultipartForm.File(
                    filename: url.lastPathComponent,
                    mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/octet-stream",
                    data: data
                ))
            }
        case .failure(let error):
            actionError = error.localizedDescription
        }
    }

    // MARK: - Sending

    @MainActor
    private func submit() {
        guard let classroomId else { return }
        isUploading = true
        actionError = nil
        Task {
            defer { isUploading = false }
            do {
                let updated = try await session.student.submitHomework(
                    classroomId: classroomId,
                    assignmentId: assignment.id,
                    files: staged,
                    expectedRevision: submission?.revision
                )
                // Only clear the staged files once the server has them.
                staged = []
                submission = updated
            } catch let error as APIError {
                actionError = error.errorDescription
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func remove(_ file: SubmissionFile) async {
        guard let classroomId else { return }
        actionError = nil
        do {
            submission = try await session.student.submitHomework(
                classroomId: classroomId,
                assignmentId: assignment.id,
                removeFileIds: [file.id],
                expectedRevision: submission?.revision,
                markAsSubmitted: false
            )
        } catch let error as APIError {
            actionError = error.errorDescription
        } catch {
            actionError = error.localizedDescription
        }
    }

    @MainActor
    private func load() async {
        guard let classroomId else {
            isLoading = false
            return
        }
        loadError = nil
        do {
            submission = try await session.student.mySubmission(
                classroomId: classroomId,
                assignmentId: assignment.id
            )
        } catch APIError.http(let status, _) where status == 404 {
            // Nothing handed in yet is a normal state, not a failure.
            submission = nil
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct SubmittedFileRow: View {
    let file: SubmissionFile
    let onRemove: @MainActor () async -> Void

    @State private var isRemoving = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "paperclip").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(file.displayName).font(.subheadline)
                if let type = file.fileType, !type.isEmpty {
                    Text(type).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if isRemoving {
                ProgressView().controlSize(.small)
            } else {
                Button {
                    isRemoving = true
                    Task {
                        await onRemove()
                        isRemoving = false
                    }
                } label: {
                    Image(systemName: "trash").foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
