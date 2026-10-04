# Simple Social v1.1

Major rebuild covering v1.0 Foundation + v1.1 Social.

## Included
- React/Vite + Firebase Auth/Firestore
- Render/Express backend with existing Google Drive media pipeline
- Real route-based navigation without a router dependency
- Home feed, Explore, profiles, notifications, settings
- Responsive desktop/mobile navigation
- Post composer with up to 10 images/videos
- @mentions and #hashtags stored on posts
- Hashtag discovery and trending tags
- Follow/unfollow and user search
- Likes, replies, reposts, bookmarks
- Block/mute filtering in the feed
- Notification center + notification preferences
- Dark/light/system preference storage
- Firestore rules for the expanded data model

## Deploy
1. Replace the existing source with this project.
2. Keep the existing Render environment variables.
3. Deploy Firestore rules from `firestore.rules`.
4. Run `npm install` then `npm run build` locally to verify, or let Render build it.
