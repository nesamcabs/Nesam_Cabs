# Admin category artwork

Open Fleet → Vehicle Categories, choose Add or Edit, and use Category Info → Category artwork.

- Category icon: a small image beside the category name and in the admin category list.
- Car image: the large vehicle photo on the customer vehicle selection cards.
- PNG, JPG and WebP are accepted, up to 5 MB per file. Each upload has a preview and can be replaced or removed.
- Files upload when the category is saved. Removing a custom image restores the existing built-in artwork. New asset URLs avoid stale browser caches.

The category record stores `iconUrl` and `imageUrl`. All three customer websites subscribe to the same active category collection. NESAM's photo selection now prioritizes the saved photo, matching the other brands. Local Taxi also uses the saved category artwork. The native NESAM customer chooser supports the uploaded assets on its next app build.

Images are stored at `category-media/{categoryId}/{icon|car}-{uuid}.{ext}`. Only staff with pricing permission can upload category assets; customer apps may read them without signing in. Overwrites, unsupported formats and files above 5 MB are blocked by Storage rules.

Validation covers TypeScript, photo selection/fallback tests for all three brands, mobile/desktop preview/remove/file validation, and emulator checks for upload permission, signed-out reads, format/size limits and public category metadata.

On 7 November 2026, the category-media Storage rules and the updated `ltGetQuotes` image response were deployed successfully. No production category images or prices were changed during testing. Firebase reported its existing non-blocking build-image cleanup warning after deployment.
