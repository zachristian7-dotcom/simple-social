import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "firebase/firestore";
import { auth, db } from "./firebase";
import "./styles.css";

const emptyProfile = {
  username: "",
  displayName: "",
  bio: "",
  createdAt: null
};

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [view, setView] = useState("home");
  const [posts, setPosts] = useState([]);
  const [following, setFollowing] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await loadProfile(currentUser.uid);
        await loadFollowing(currentUser.uid);
      } else {
        setProfile(emptyProfile);
        setFollowing([]);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (user) loadPosts();
  }, [user, following]);

  async function loadProfile(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) setProfile(snap.data());
  }

  async function loadFollowing(uid) {
    const snap = await getDocs(
      query(collection(db, "follows"), where("followerId", "==", uid))
    );
    setFollowing(snap.docs.map((d) => d.data().followingId));
  }

  async function loadPosts() {
    const snap = await getDocs(
      query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50))
    );
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setPosts(data);
  }

  async function createPost(text) {
    if (!text.trim() || !user) return;
    await addDoc(collection(db, "posts"), {
      authorId: user.uid,
      authorName: profile.displayName || profile.username || user.email.split("@")[0],
      text: text.trim(),
      likeCount: 0,
      commentCount: 0,
      createdAt: serverTimestamp()
    });
    await loadPosts();
  }

  async function toggleLike(post) {
    if (!user) return;
    const likeId = `${post.id}_${user.uid}`;
    const likeRef = doc(db, "likes", likeId);
    const existing = await getDoc(likeRef);

    if (existing.exists()) {
      await deleteDoc(likeRef);
      await setDoc(doc(db, "posts", post.id), {
        likeCount: increment(-1)
      }, { merge: true });
    } else {
      await setDoc(likeRef, {
        postId: post.id,
        userId: user.uid,
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "posts", post.id), {
        likeCount: increment(1)
      }, { merge: true });
    }

    await loadPosts();
  }

  async function createComment(postId, text) {
    if (!text.trim() || !user) return;
    await addDoc(collection(db, "comments"), {
      postId,
      authorId: user.uid,
      authorName: profile.displayName || profile.username || "User",
      text: text.trim(),
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "posts", postId), {
      commentCount: increment(1)
    }, { merge: true });
    await loadPosts();
  }

  async function follow(uid) {
    if (!user || uid === user.uid) return;
    const id = `${user.uid}_${uid}`;
    await setDoc(doc(db, "follows", id), {
      followerId: user.uid,
      followingId: uid,
      createdAt: serverTimestamp()
    });
    await loadFollowing(user.uid);
  }

  async function unfollow(uid) {
    if (!user) return;
    await deleteDoc(doc(db, "follows", `${user.uid}_${uid}`));
    await loadFollowing(user.uid);
  }

  if (loading) return <div className="center">Loading…</div>;
  if (!user) return <AuthScreen />;

  const visiblePosts = posts.filter(
    (p) => p.authorId === user.uid || following.includes(p.authorId)
  );

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")}>Simple Social</button>
        <nav>
          <button onClick={() => setView("home")}>Home</button>
          <button onClick={() => setView("search")}>Search</button>
          <button onClick={() => setView("profile")}>Profile</button>
          <button className="logout" onClick={() => signOut(auth)}>Log out</button>
        </nav>
      </header>

      <main className="container">
        {view === "home" && (
          <>
            <PostComposer onPost={createPost} />
            <section>
              <div className="section-title">
                <h2>Your feed</h2>
                <button className="small-button" onClick={loadPosts}>Refresh</button>
              </div>
              {visiblePosts.length === 0 ? (
                <Empty text="No posts yet. Follow someone or make your first post." />
              ) : (
                visiblePosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    user={user}
                    onLike={() => toggleLike(post)}
                    onComment={createComment}
                  />
                ))
              )}
            </section>
          </>
        )}

        {view === "profile" && (
          <Profile
            user={user}
            profile={profile}
            posts={posts.filter((p) => p.authorId === user.uid)}
          />
        )}

        {view === "search" && (
          <Search
            user={user}
            following={following}
            onFollow={follow}
            onUnfollow={unfollow}
          />
        )}
      </main>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: username });
        await setDoc(doc(db, "users", cred.user.uid), {
          username: username.toLowerCase().replace(/[^a-z0-9_]/g, ""),
          displayName: username,
          bio: "",
          createdAt: serverTimestamp()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message.replace("Firebase: ", ""));
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Simple Social</h1>
        <p className="muted">{mode === "login" ? "Welcome back." : "Create an account."}</p>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <input
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength="6"
            required
          />
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">
            {mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </div>
    </div>
  );
}

function PostComposer({ onPost }) {
  const [text, setText] = useState("");
  async function submit(e) {
    e.preventDefault();
    await onPost(text);
    setText("");
  }
  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        placeholder="What's on your mind?"
        value={text}
        maxLength="500"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="composer-bottom">
        <span>{text.length}/500</span>
        <button className="primary" disabled={!text.trim()}>Post</button>
      </div>
    </form>
  );
}

function PostCard({ post, onLike, onComment }) {
  const [comment, setComment] = useState("");
  const date = post.createdAt?.toDate?.().toLocaleString() || "just now";

  async function submit(e) {
    e.preventDefault();
    await onComment(post.id, comment);
    setComment("");
  }

  return (
    <article className="post">
      <div className="post-header">
        <strong>{post.authorName || "User"}</strong>
        <span>{date}</span>
      </div>
      <p className="post-text">{post.text}</p>
      <div className="post-actions">
        <button onClick={onLike}>♡ {post.likeCount || 0}</button>
        <span>💬 {post.commentCount || 0}</span>
      </div>
      <form className="comment-form" onSubmit={submit}>
        <input
          placeholder="Write a comment…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <button disabled={!comment.trim()}>Comment</button>
      </form>
    </article>
  );
}

function Profile({ user, profile, posts }) {
  return (
    <section className="profile-card">
      <div className="avatar">{(profile.displayName || "U")[0].toUpperCase()}</div>
      <h1>{profile.displayName || "User"}</h1>
      <p className="muted">@{profile.username || user.uid.slice(0, 8)}</p>
      <p>{profile.bio || "No bio yet."}</p>
      <div className="profile-stat"><strong>{posts.length}</strong> posts</div>
      <h2>Your posts</h2>
      {posts.map((post) => <PostCard key={post.id} post={post} user={user} onLike={() => {}} onComment={() => {}} />)}
    </section>
  );
}

function Search({ user, following, onFollow, onUnfollow }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);

  async function search() {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    const snap = await getDocs(
      query(
        collection(db, "users"),
        where("username", ">=", term.toLowerCase()),
        where("username", "<=", term.toLowerCase() + "\uf8ff"),
        limit(20)
      )
    );
    setResults(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  return (
    <section>
      <h1>Search</h1>
      <div className="search-box">
        <input
          placeholder="Search usernames…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="primary" onClick={search}>Search</button>
      </div>

      {results.map((person) => {
        const isFollowing = following.includes(person.id);
        return (
          <div className="user-result" key={person.id}>
            <div>
              <strong>{person.displayName}</strong>
              <span>@{person.username}</span>
            </div>
            {person.id !== user.uid && (
              <button
                onClick={() => isFollowing ? onUnfollow(person.id) : onFollow(person.id)}
              >
                {isFollowing ? "Following" : "Follow"}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

createRoot(document.getElementById("root")).render(<App />);