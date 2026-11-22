"use client";

import type { CanonicalRole } from "@/lib/roles";
import { Sheet } from "@/features/console/ui";
import { PlainBoxes } from "./Fieldset";
import { ParentCard } from "./ParentCard";
import { PersonForm } from "./PersonForm";
import type { PersonCore } from "./personApi";

/**
 * The profile's ✎ (StudentProfile board): the account's form — name, username, email, phone, role — and the parent's
 * contact, in a side sheet over the profile. The same forms the old Overview tab held, with the same locks
 * (lc-up's fields, the viewer's rights); nothing is new here but where they open.
 */
export function EditStudentSheet({
  open,
  onClose,
  person,
  onSaved,
  readOnly,
  parentReadOnly,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  person: PersonCore;
  onSaved: () => void;
  /** The viewer may not change this account (`mayChangeAccount`): the form is shown, not saved. */
  readOnly: boolean;
  /** Without `edit_people` the parent's contact is shown, not changed. */
  parentReadOnly: boolean;
  roles: readonly CanonicalRole[];
}) {
  return (
    <Sheet open={open} onClose={onClose} title={readOnly ? "Student details" : "Edit student"} wide>
      <PlainBoxes>
        <div className="flex flex-col gap-7">
          <PersonForm key={person.id} person={person} onSaved={onSaved} readOnly={readOnly} roles={roles} />
          {person.parent ? (
            <ParentCard key={`parent-${person.id}`} id={person.id} parent={person.parent} onSaved={onSaved} readOnly={parentReadOnly} />
          ) : null}
        </div>
      </PlainBoxes>
    </Sheet>
  );
}
