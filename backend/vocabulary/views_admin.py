"""
Builder vocabulary API (``/api/vocabulary/admin/``).

Gated by ``CanAuthorVocabulary`` — builder staff only. Teachers deliberately have no
authoring rights here: they only *assign* an existing set as classroom homework.

These endpoints operate on BANK content exclusively. Every set queryset is filtered to
``owner__isnull=True`` so a student's custom set can never be read or mutated from the
console, no matter what id is supplied.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import CanAuthorVocabulary
from users.permissions import IsAuthenticatedAndNotFrozen

from .csv_import import import_section_csv, import_set_csv
from .models import (
    VocabHomework,
    VocabSection,
    VocabSet,
    VocabSetItem,
    VocabWord,
)
from .serializers import (
    VocabSectionWriteSerializer,
    VocabSetWriteSerializer,
    VocabWordWriteSerializer,
    section_counts,
    set_word_counts,
    words_by_set,
)

VOCAB_ADMIN_PERMS = [IsAuthenticatedAndNotFrozen, CanAuthorVocabulary]


# --------------------------------------------------------------------------- helpers


def _bank_sets():
    """Bank sets only — a student's custom set is not builder content."""
    return VocabSet.objects.filter(owner__isnull=True, section__isnull=False)


def _unique_slug(title: str, *, exclude_pk: int | None = None) -> str:
    """Derive a slug from the title, suffixing ``-2``, ``-3``… on collision."""
    base = slugify(title)[:200] or "section"
    qs = VocabSection.objects.all()
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    slug = base
    counter = 2
    while qs.filter(slug=slug).exists():
        slug = f"{base}-{counter}"[:220]
        counter += 1
    return slug


def _section_out(section: VocabSection, *, set_count: int, word_count: int) -> dict:
    return {
        "id": section.id,
        "title": section.title,
        "slug": section.slug,
        "description": section.description,
        "order": section.order,
        "is_published": section.is_published,
        "set_count": set_count,
        "word_count": word_count,
        "created_at": section.created_at,
    }


def _one_section_out(section: VocabSection) -> dict:
    set_counts, word_counts = section_counts([section.id])
    return _section_out(
        section,
        set_count=set_counts.get(section.id, 0),
        word_count=word_counts.get(section.id, 0),
    )


def _admin_word_out(word: VocabWord, *, order: int | None = None) -> dict:
    data = {
        "id": word.id,
        "word": word.word,
        "definition": word.definition,
        "part_of_speech": word.part_of_speech,
        "example": word.example,
        "synonyms": list(word.synonyms or []),
        "section_id": word.section_id,
    }
    if order is not None:
        data["order"] = order
    return data


def _admin_set_out(vocab_set: VocabSet, *, word_count: int) -> dict:
    return {
        "id": vocab_set.id,
        "title": vocab_set.title,
        "order": vocab_set.order,
        "section_id": vocab_set.section_id,
        "word_count": word_count,
    }


def _set_has_homework(vocab_set: VocabSet) -> bool:
    return vocab_set.homework_links.exists()


def _csv_bytes_or_error(request) -> tuple[bytes | None, Response | None]:
    upload = request.FILES.get("file")
    if upload is None:
        return None, Response(
            {"detail": "Attach a CSV file in the 'file' field."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return upload.read(), None


# --------------------------------------------------------------------------- sections


class AdminSectionListCreateView(APIView):
    permission_classes = VOCAB_ADMIN_PERMS

    def get(self, request):
        sections = list(VocabSection.objects.all())
        ids = [s.id for s in sections]
        set_counts, word_counts = section_counts(ids)
        return Response(
            [
                _section_out(
                    s,
                    set_count=set_counts.get(s.id, 0),
                    word_count=word_counts.get(s.id, 0),
                )
                for s in sections
            ]
        )

    def post(self, request):
        ser = VocabSectionWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        slug = (data.get("slug") or "").strip()
        if slug:
            if VocabSection.objects.filter(slug=slug).exists():
                return Response(
                    {"slug": ["A section with this slug already exists."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            slug = _unique_slug(data["title"])
        section = VocabSection.objects.create(
            title=data["title"],
            slug=slug,
            description=data.get("description") or "",
            order=data.get("order", 0),
            is_published=data.get("is_published", True),
            created_by=request.user,
        )
        return Response(_one_section_out(section), status=status.HTTP_201_CREATED)


class AdminSectionDetailView(APIView):
    permission_classes = VOCAB_ADMIN_PERMS

    def get(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk)
        sets = list(_bank_sets().filter(section=section))
        counts = set_word_counts([s.id for s in sets])
        data = _one_section_out(section)
        data["sets"] = [_admin_set_out(s, word_count=counts.get(s.id, 0)) for s in sets]
        return Response(data)

    def patch(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk)
        ser = VocabSectionWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        fields: list[str] = []
        if "title" in data:
            section.title = data["title"]
            fields.append("title")
        if "description" in data:
            section.description = data["description"]
            fields.append("description")
        if "order" in data:
            section.order = data["order"]
            fields.append("order")
        if "is_published" in data:
            section.is_published = data["is_published"]
            fields.append("is_published")
        slug = (data.get("slug") or "").strip()
        if slug:
            if VocabSection.objects.filter(slug=slug).exclude(pk=section.pk).exists():
                return Response(
                    {"slug": ["A section with this slug already exists."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            section.slug = slug
            fields.append("slug")
        if fields:
            section.save(update_fields=fields + ["updated_at"])
        return Response(_one_section_out(section))

    def delete(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk)
        # Deleting a section CASCADES to its sets, so an assigned set anywhere under it
        # would take a classroom's homework down with it.
        if VocabHomework.objects.filter(vocab_set__section=section).exists():
            return Response(
                {
                    "detail": (
                        "A set in this section is assigned as homework. Unassign it first, "
                        "or unpublish the section instead."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        try:
            section.delete()
        except ProtectedError:
            return Response(
                {"detail": "This section is referenced elsewhere and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminSectionSetListCreateView(APIView):
    permission_classes = VOCAB_ADMIN_PERMS

    def get(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk)
        sets = list(_bank_sets().filter(section=section))
        counts = set_word_counts([s.id for s in sets])
        return Response(
            [_admin_set_out(s, word_count=counts.get(s.id, 0)) for s in sets]
        )

    def post(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk)
        ser = VocabSetWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        vocab_set = VocabSet.objects.create(
            section=section,
            title=data["title"],
            order=data.get("order", section.sets.count()),
        )
        return Response(_admin_set_out(vocab_set, word_count=0), status=status.HTTP_201_CREATED)


# --------------------------------------------------------------------------- sets


class AdminSetDetailView(APIView):
    permission_classes = VOCAB_ADMIN_PERMS

    def get(self, request, pk: int):
        vocab_set = get_object_or_404(_bank_sets().select_related("section"), pk=pk)
        words = words_by_set([vocab_set.pk])[vocab_set.pk]
        data = _admin_set_out(vocab_set, word_count=len(words))
        data["section"] = {"id": vocab_set.section_id, "title": vocab_set.section.title}
        data["words"] = [
            _admin_word_out(w, order=idx) for idx, w in enumerate(words)
        ]
        return Response(data)

    def patch(self, request, pk: int):
        vocab_set = get_object_or_404(_bank_sets(), pk=pk)
        ser = VocabSetWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        fields: list[str] = []
        if "title" in data:
            vocab_set.title = data["title"]
            fields.append("title")
        if "order" in data:
            vocab_set.order = data["order"]
            fields.append("order")
        if fields:
            vocab_set.save(update_fields=fields + ["updated_at"])
        counts = set_word_counts([vocab_set.pk])
        return Response(_admin_set_out(vocab_set, word_count=counts.get(vocab_set.pk, 0)))

    def delete(self, request, pk: int):
        vocab_set = get_object_or_404(_bank_sets(), pk=pk)
        if _set_has_homework(vocab_set):
            return Response(
                {
                    "detail": (
                        "This set is assigned as homework. Unassign it from every class "
                        "before deleting it."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        try:
            vocab_set.delete()
        except ProtectedError:
            return Response(
                {"detail": "This set is referenced elsewhere and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- words


class AdminSetWordListCreateView(APIView):
    permission_classes = VOCAB_ADMIN_PERMS

    def get(self, request, pk: int):
        vocab_set = get_object_or_404(_bank_sets(), pk=pk)
        words = words_by_set([vocab_set.pk])[vocab_set.pk]
        return Response([_admin_word_out(w, order=idx) for idx, w in enumerate(words)])

    def post(self, request, pk: int):
        vocab_set = get_object_or_404(_bank_sets().select_related("section"), pk=pk)
        ser = VocabWordWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        # Words are scoped to the SECTION, so a headword the section already teaches is
        # linked into this set rather than duplicated (matching the CSV importer).
        existing = VocabWord.objects.filter(
            section_id=vocab_set.section_id, word__iexact=data["word"].strip()
        ).first()
        if existing is not None and VocabSetItem.objects.filter(
            vocab_set=vocab_set, word=existing
        ).exists():
            return Response(
                {"word": ["Already in this set."]}, status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            word = existing
            if word is None:
                word = VocabWord.objects.create(
                    section_id=vocab_set.section_id,
                    word=data["word"],
                    definition=data["definition"],
                    part_of_speech=data.get("part_of_speech") or VocabWord.PART_OTHER,
                    example=data.get("example") or "",
                    synonyms=data.get("synonyms") or [],
                )
            order = VocabSetItem.objects.filter(vocab_set=vocab_set).count()
            VocabSetItem.objects.create(vocab_set=vocab_set, word=word, order=order)
        return Response(_admin_word_out(word, order=order), status=status.HTTP_201_CREATED)


class AdminWordDetailView(APIView):
    permission_classes = VOCAB_ADMIN_PERMS

    def get(self, request, pk: int):
        word = get_object_or_404(VocabWord, pk=pk)
        return Response(_admin_word_out(word))

    def patch(self, request, pk: int):
        word = get_object_or_404(VocabWord, pk=pk)
        ser = VocabWordWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        fields: list[str] = []
        if "word" in data:
            # UNIQUE(section, word) would 500 on a bare save; report it as a field error.
            clash = (
                VocabWord.objects.filter(
                    section_id=word.section_id, word__iexact=data["word"].strip()
                )
                .exclude(pk=word.pk)
                .exists()
            )
            if clash:
                return Response(
                    {"word": ["This section already has this word."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            word.word = data["word"]
            fields.append("word")
        if "definition" in data:
            word.definition = data["definition"]
            fields.append("definition")
        if "part_of_speech" in data:
            word.part_of_speech = data["part_of_speech"]
            fields.append("part_of_speech")
        if "example" in data:
            word.example = data["example"]
            fields.append("example")
        if "synonyms" in data:
            word.synonyms = data["synonyms"]
            fields.append("synonyms")
        if fields:
            word.save(update_fields=fields + ["updated_at"])
        return Response(_admin_word_out(word))

    def delete(self, request, pk: int):
        # Removes the word from the bank entirely: its set links and every student's
        # progress row cascade away with it. There is no "unlink from this set only" —
        # a bank word exists to be studied, and an unused one is noise.
        word = get_object_or_404(VocabWord, pk=pk)
        word.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- CSV import


class AdminSectionCsvImportView(APIView):
    """Import a whole section's words, bucketed into sets by the CSV's ``set`` column."""

    permission_classes = VOCAB_ADMIN_PERMS
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk: int):
        section = get_object_or_404(VocabSection, pk=pk)
        raw, denied = _csv_bytes_or_error(request)
        if denied is not None:
            return denied
        result, err = import_section_csv(section=section, raw_bytes=raw)
        if err is not None:
            return Response(err, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_201_CREATED)


class AdminSetCsvImportView(APIView):
    """Append words to ONE set. A ``set`` column in the file is ignored."""

    permission_classes = VOCAB_ADMIN_PERMS
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk: int):
        vocab_set = get_object_or_404(_bank_sets().select_related("section"), pk=pk)
        raw, denied = _csv_bytes_or_error(request)
        if denied is not None:
            return denied
        result, err = import_set_csv(vocab_set=vocab_set, raw_bytes=raw)
        if err is not None:
            return Response(err, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_201_CREATED)
