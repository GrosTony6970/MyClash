/**
 * The body of a roster row's edit.
 *
 * The address is sent only when the organiser changed it. The form is filled from a list that was
 * loaded earlier, and a fighter may have changed the address of her account since: her roster rows
 * follow it. Sending the form's older address back would overwrite hers, and a claimed row whose
 * address is not its holder's is taken from the account (operator ruling 203).
 */
export function editPersonBody(
  person: { email: string | null },
  form: { givenName: string; familyName: string; email: string; hemaRatingsId: string },
  clubId: string | null,
) {
  const email = form.email.trim() || null;
  return {
    givenName: form.givenName.trim(),
    familyName: form.familyName.trim(),
    ...(email === person.email ? {} : { email }),
    clubId: clubId || null,
    hemaRatingsId: form.hemaRatingsId.trim() || null,
  };
}
