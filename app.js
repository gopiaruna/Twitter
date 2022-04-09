const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running");
    });
  } catch (e) {
    console.log(`Database Error : ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const validatePassword = (password) => {
  return password.length > 6;
};

const convertTweetToJson = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

const tweetsStats = (dbObject) => {
  return {
    tweet: dbObject.tweet,
    likes: dbObject.likes,
    replies: dbObject.replies,
    dateTime: dbObject.date_time,
  };
};

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;

  const hashedPassword = await bcrypt.hash(request.body.password, 10);

  const userCheckingInDatabase = `SELECT * FROM user WHERE username = '${username}';`;

  const dbUser = await database.get(userCheckingInDatabase);

  if (dbUser === undefined) {
    const createNewUserInDatabase = `INSERT INTO
user (username, name, password, gender)
VALUES
(
'${username}',
'${name}',
'${hashedPassword}',
'${gender}'
);`;
    if (validatePassword(password)) {
      await database.run(createNewUserInDatabase);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const userCheckingInDatabase = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(userCheckingInDatabase);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const passwordComparing = await bcrypt.compare(password, dbUser.password);
    if (passwordComparing === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const getUserIdFun = async (username) => {
  const userIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const userId = await database.get(userIdQuery);
  return userId.user_id;
};
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const userId = await getUserIdFun(username);
  const getTweetQuery = `SELECT
username,tweet,date_time
FROM
(follower INNER JOIN tweet ON follower.following_user_id=tweet.user_id) AS T NATURAL JOIN user
WHERE
follower.follower_user_id = ${userId}
ORDER BY
date_time DESC
LIMIT 4;`;
  const data = await database.all(getTweetQuery);
  response.send(data.map((tweet) => convertTweetToJson(tweet)));
});

app.get("/users/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserIdFun(username);
  const getFollowingNamesQuery = `
SELECT username AS name FROM user INNER JOIN follower ON user.user_id = follower.following_user_id WHERE
follower.follower_user_id = ${userId};
`;
  const data = await database.all(getFollowingNamesQuery);
  response.send(data);
});

app.get("/users/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserIdFun(username);
  const getFollowingNamesQuery = `
SELECT username AS name FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE
follower.following_user_id = ${userId};
`;
  const data = await database.all(getFollowingNamesQuery);
  response.send(data);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserIdFun(username);
  const { tweetId } = request.params;
  const getTweetQuery = `
SELECT
*
FROM
tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
WHERE
tweet_id = ${tweetId} AND follower_user_id = ${userId};
`;
  const tweet = await database.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getLikeCountQuery = `
SELECT
COUNT(*) as likes
FROM
tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
WHERE tweet.tweet_id = ${tweetId}
`;
    const getLikeCount = await database.all(getLikeCountQuery);
    const getReplyQuery = `
SELECT
COUNT(*) as replies
FROM
tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
WHERE tweet.tweet_id = ${tweetId}
`;
    const getReplyCount = await database.all(getReplyQuery);
    response.send({
      tweet: tweet["tweet"],
      likes: getLikeCount[0]["likes"],
      replies: getReplyCount[0]["replies"],
      dateTime: tweet["date_time"],
    });
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userId = await getUserIdFun(username);

    const getTweetQuery = `
SELECT
*
FROM
tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
WHERE
tweet_id = ${tweetId} AND follower_user_id = ${userId};
`;
    const tweet = await database.get(getTweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikeCountQuery = `
SELECT
username
FROM
(tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id)INNER JOIN user ON user.user_id = like.user_id
WHERE tweet.tweet_id = ${tweetId}
`;
      const getLikeCount = await database.all(getLikeCountQuery);
      const dataList = getLikeCount.map((each) => each.username);
      response.send({ likes: dataList });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userId = await getUserIdFun(username);

    const getTweetQuery = `
SELECT
*
FROM
tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
WHERE
tweet_id = ${tweetId} AND follower_user_id = ${userId};
`;
    const tweet = await database.get(getTweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getReplyQuery = `
SELECT
username AS name ,
reply
FROM
(tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id ) INNER JOIN user ON user.user_id = reply.user_id
WHERE tweet.tweet_id = ${tweetId}
`;
      const getReplyCount = await database.all(getReplyQuery);
      response.send({ replies: getReplyCount });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserIdFun(username);
  const tweetQuery = `
SELECT
tweet,COUNT(*) AS likes,
(
SELECT
COUNT(*) AS replies
FROM
tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
WHERE tweet.user_id = ${userId}
GROUP BY
tweet.tweet_id
) AS replies,tweet.date_time
FROM
tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
WHERE tweet.user_id = ${userId}
GROUP BY
tweet.tweet_id;
`;
  const tweetData = await database.all(tweetQuery);
  response.send(tweetData.map((tweet) => tweetsStats(tweet)));
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserIdFun(username);
  const { tweet } = request.body;
  const postTweetQuery = `
INSERT INTO
tweet (tweet,user_id)
VALUES
('${tweet}',${userId})
`;
  await database.run(postTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const userId = await getUserIdFun(username);
    const { tweetId } = request.params;
    const getTweetQuery = `
SELECT
*
FROM
tweet
WHERE tweet_id = ${tweetId}
`;
    const tweet = await database.get(getTweetQuery);
    const { user_id } = tweet;
    if (user_id === userId) {
      const deleteTweetQuery = `
DELETE FROM
tweet
WHERE tweet_id = ${tweetId}
`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
