/**
 * A Workshop's two short texts (ruling 557): the line on its catalogue card, and what a learner
 * should know or bring. The server refuses longer ones; the forms stop typing there.
 */
export const WORKSHOP_SHORT_DESCRIPTION_MAX = 200;
export const WORKSHOP_PREREQUISITES_MAX = 2000;

/**
 * What one Workshop says about one of its instructors, over their profile (rulings 556, 560): a
 * bio (the profile's own limit) and a club line.
 */
export const WORKSHOP_INSTRUCTOR_BIO_MAX = 2000;
export const WORKSHOP_INSTRUCTOR_CLUB_MAX = 200;
/** The photo's cap: the server refuses a larger file, the forms refuse to pick one. */
export const WORKSHOP_INSTRUCTOR_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
