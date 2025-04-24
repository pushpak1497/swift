// server.ts
import http, { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { MongoClient, Db, Collection } from "mongodb";

interface Geo {
  lat: string;
  lng: string;
}

interface Address {
  street: string;
  suite: string;
  city: string;
  zipcode: string;
  geo: Geo;
}

interface Company {
  name: string;
  catchPhrase: string;
  bs: string;
}

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  address: Address;
  phone: string;
  website: string;
  company: Company;
}

export interface Post {
  id: number;
  userId: number;
  title: string;
  body: string;
}

export interface Comment {
  id: number;
  postId: number;
  name: string;
  email: string;
  body: string;
}

interface PostWithComments extends Post {
  comments: Comment[];
}

interface UserWithPosts extends User {
  posts: PostWithComments[];
}
//changed the password in mongodb url for security reasons because we shouldnot add dotenv package
const MONGO_URL =
  `mongodb+srv://pushpakvyas1497:${DB_PASSWORD}@swiftcluster0.nlb52.mongodb.net`;
const DB_NAME = "node_assignment_db";

let db: Db;
let usersCollection: Collection<User>;
let postsCollection: Collection<Post>;
let commentsCollection: Collection<Comment>;

async function connectToDb() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  usersCollection = db.collection<User>("users");
  postsCollection = db.collection<Post>("posts");
  commentsCollection = db.collection<Comment>("comments");
  console.log("Connected to MongoDB");
}

async function loadData(): Promise<void> {
  await Promise.all([
    usersCollection.deleteMany({}),
    postsCollection.deleteMany({}),
    commentsCollection.deleteMany({}),
  ]);

  const usersResponse = await fetch(
    "https://jsonplaceholder.typicode.com/users"
  );
  const users: User[] = (await usersResponse.json()) as User[];

  for (const user of users) {
    await usersCollection.insertOne(user);

    const postsResponse = await fetch(
      `https://jsonplaceholder.typicode.com/posts?userId=${user.id}`
    );
    const posts: Post[] = (await postsResponse.json()) as Post[];

    for (const post of posts) {
      await postsCollection.insertOne(post);

      const commentsResponse = await fetch(
        `https://jsonplaceholder.typicode.com/comments?postId=${post.id}`
      );
      const comments: Comment[] = (await commentsResponse.json()) as Comment[];
      if (comments.length > 0) {
        await commentsCollection.insertMany(comments);
      }
    }
  }
}

async function getUserData(userId: number): Promise<UserWithPosts | null> {
  const user = await usersCollection.findOne({ id: userId });
  if (!user) return null;

  const posts = await postsCollection.find({ userId }).toArray();
  const postsWithComments: PostWithComments[] = [];

  for (const post of posts) {
    const comments = await commentsCollection
      .find({ postId: post.id })
      .toArray();
    postsWithComments.push({ ...post, comments });
  }

  return { ...user, posts: postsWithComments };
}

async function parseRequestBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        resolve(data);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", (err) => reject(err));
  });
}

const server = http.createServer(
  (req: IncomingMessage, res: ServerResponse) => {
    (async () => {
      if (!req.url) {
        res.writeHead(400);
        return res.end("Bad Request");
      }
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;
      const method = req.method || "";

      if (method === "GET" && pathname === "/load") {
        try {
          await loadData();
          res.writeHead(200);
          return res.end();
        } catch (err) {
          console.error(err);
          res.writeHead(500);
          return res.end("Error loading data");
        }
      }

      if (method === "DELETE" && pathname === "/users") {
        try {
          await Promise.all([
            usersCollection.deleteMany({}),
            postsCollection.deleteMany({}),
            commentsCollection.deleteMany({}),
          ]);
          res.writeHead(200);
          return res.end("All users (and related posts/comments) deleted");
        } catch (err) {
          console.error(err);
          res.writeHead(500);
          return res.end("Error deleting users");
        }
      }

      if (pathname.startsWith("/users/")) {
        const parts = pathname.split("/").filter((p) => p);
        const userIdStr = parts[1];
        const userId = Number(userIdStr);
        if (isNaN(userId)) {
          res.writeHead(400);
          return res.end("Invalid userId");
        }

        if (method === "DELETE") {
          try {
            const user = await usersCollection.findOne({ id: userId });
            if (!user) {
              res.writeHead(404);
              return res.end("User not found");
            }
            await usersCollection.deleteOne({ id: userId });
            const posts = await postsCollection.find({ userId }).toArray();
            const postIds = posts.map((post) => post.id);
            await postsCollection.deleteMany({ userId });
            if (postIds.length > 0) {
              await commentsCollection.deleteMany({ postId: { $in: postIds } });
            }
            res.writeHead(200);
            return res.end(
              `User ${userId} and associated posts/comments deleted`
            );
          } catch (err) {
            console.error(err);
            res.writeHead(500);
            return res.end("Error deleting user");
          }
        }

        if (method === "GET") {
          try {
            const userData = await getUserData(userId);
            if (!userData) {
              res.writeHead(404, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ error: "User not found" }));
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify(userData));
          } catch (err) {
            console.error(err);
            res.writeHead(500);
            return res.end("Error fetching user data");
          }
        }
      }

      if (method === "PUT" && pathname === "/users") {
        try {
          const newUser: User = await parseRequestBody(req);
          if (newUser.id === undefined) {
            res.writeHead(400);
            return res.end("Missing user id in request body");
          }
          const existing = await usersCollection.findOne({ id: newUser.id });
          if (existing) {
            res.writeHead(409);
            return res.end("User already exists");
          }
          await usersCollection.insertOne(newUser);
          res.setHeader("Link", `/users/${newUser.id}`);
          res.writeHead(201);
          return res.end(`User ${newUser.id} created`);
        } catch (err) {
          console.error(err);
          res.writeHead(400);
          return res.end("Invalid JSON or error processing request");
        }
      }

      res.writeHead(404);
      return res.end("Endpoint not found");
    })().catch((err) => {
      console.error("Unexpected error:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    });
  }
);

async function startServer() {
  try {
    await connectToDb();
    const PORT = 3000;
    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
}

startServer();
