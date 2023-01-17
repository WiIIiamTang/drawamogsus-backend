import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import wordlist from "./fruitsandvegetables.js";
import { stringify } from "querystring";
import mysql, { RowDataPacket } from "mysql2";

dotenv.config();

const app = express();
const connection = mysql.createConnection(process.env.DATABASE_URL || "");

app.get("/health/healthcheck", (req, res) => {
  res.send("OK");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
  },
});

type Point = {
  x: number;
  y: number;
};

type DrawLine = {
  prevPoint: Point | null;
  currentPoint: Point | null;
  color: string;
  canvasWidth: number;
  canvasHeight: number;
};

type User = {
  id: string;
  name: string;
  role?: string | null;
  firstdraw?: boolean;
  hasDrawn?: boolean;
  voteCallback?: (
    scores: Array<userScore>,
    imposter: string,
    users_fooled: number
  ) => void;
  score?: number;
  fooled?: boolean;
};

type userScore = {
  name: string;
  score: number;
};

type Dic = {
  [key: string]: Array<User>;
};

type RoomSetting = {
  timeBeforeStart: number;
  timeDraw: number;
  timeVote: number;
  numberRounds: number;
  wordCategory?: string;
  word?: string;
};

type RoomSettings = {
  [room: string]: RoomSetting;
};

interface WordlistWord extends RowDataPacket {
  word?: string;
  category?: string;
  difficulty?: string;
}

const rooms: Dic = {};
const roomSettings: RoomSettings = {};

io.on("connection", (socket) => {
  socket.on(
    "draw_line",
    (
      { prevPoint, currentPoint, color, canvasWidth, canvasHeight }: DrawLine,
      room: string
    ) => {
      io.to(room).emit("draw_line", {
        prevPoint,
        currentPoint,
        color,
        canvasWidth,
        canvasHeight,
      });
    }
  );

  socket.on("clear", (room) => io.to(room).emit("clear")); // emit to all clients - change to broadcast later for rooms

  socket.on(
    "join_room",
    (
      room: string,
      name: string,
      callback: (
        success: boolean,
        takenNickname: boolean,
        timeToStart: number,
        timeToDraw: number,
        timeToVote: number,
        rounds: number,
        userScores: Array<userScore>
      ) => void
    ) => {
      if (!rooms[room]) {
        socket.emit("room_does_not_exist");
        callback(false, false, -1, -1, -1, -1, []);
        return;
      }
      // check if name is taken
      const takenNickname = rooms[room].find((user) => user.name === name);
      if (takenNickname) {
        callback(false, true, -1, -1, -1, -1, []);
        return;
      }
      socket.join(room);
      rooms[room].push({ id: socket.id, name: name });
      io.to(room).emit("joined_room", room, name);
      const settings = roomSettings[room];
      callback(
        true,
        false,
        settings.timeBeforeStart,
        settings.timeDraw,
        settings.timeVote,
        settings.numberRounds,
        rooms[room].map((user) => {
          return { name: user.name, score: user.score || 0 };
        })
      );
    }
  );

  socket.on("room_user_update", (room: string) => {
    io.to(room).emit(
      "users_room_update",
      rooms[room].map((user) => user.name)
    );
  });

  socket.on(
    "create_room",
    (
      room: string,
      name: string,
      numberRounds: number,
      timeDraw: number,
      timeBeforeStart: number,
      timeVote: number,
      wordCategory: string,
      callback: (success: boolean) => void
    ) => {
      if (rooms[room]) {
        socket.emit("room_exists");
        callback(false);
        return;
      }
      roomSettings[room] = {
        numberRounds: numberRounds,
        timeDraw: timeDraw,
        timeBeforeStart: timeBeforeStart,
        timeVote: timeVote,
        wordCategory: wordCategory,
      };
      rooms[room] = [];
      rooms[room].push({ id: socket.id, name: name });
      socket.join(room);
      io.to(room).emit("created_room", room, name);
      callback(true);
    }
  );

  socket.on("leave_room", (room: string, name: string) => {
    if (!rooms[room]) {
      return;
    }
    rooms[room] = rooms[room].filter((user) => user.id !== socket.id);
    socket.leave(room);
    io.to(room).emit("left_room", room, name);

    if (rooms[room].length === 0) {
      delete rooms[room];
      delete roomSettings[room];
    }
  });

  socket.on("chat_room", (room: string, message: string, name: string) => {
    socket.to(room).emit("chat_room", message, name);
  });

  /**
   * Does not work well when scaling the canvas to different sizes, cannot do for now
   */

  // socket.on("client_ready", () => {
  //   console.log("client read", socket.id);
  //   socket.broadcast.emit("get_canvas_state");
  // });

  // socket.on("canvas_state", (data: string) => {
  //   socket.broadcast.emit("canvas_state_from_server", data);
  // });

  socket.on("disconnect", () => {
    // find user name based on their id
    const room = Object.keys(rooms).find((room) =>
      rooms[room].find((user) => user.id === socket.id)
    );
    if (!room) {
      return;
    }
    const username = rooms[room].find((user) => user.id === socket.id)?.name;

    io.emit("left_room_dc", username);
  });

  socket.on("game_start", (room: string, name: string) => {
    if (!rooms[room]) {
      return;
    }
    // add a role to each user in the room
    const imposterIndex = Math.floor(Math.random() * rooms[room].length);
    // pick a random index to draw first
    const firstDrawIndex = Math.floor(Math.random() * rooms[room].length);
    rooms[room].forEach((user, index) => {
      // pick a random index to be the imposter
      if (index === imposterIndex) {
        user.role = "imposter";
      } else {
        user.role = "artist"; // others are normal
      }

      if (index === firstDrawIndex) {
        user.firstdraw = true;
        user.hasDrawn = true;
      } else {
        user.firstdraw = false;
        user.hasDrawn = false;
      }

      user.voteCallback = undefined;
      user.fooled = undefined;
    });
    io.to(room).emit("game_start", name);

    let sql = `SELECT word FROM wordlist WHERE category='${
      roomSettings[room].wordCategory || "animal"
    }' ORDER BY RAND() LIMIT 1`;
    let word = "";

    connection.query<WordlistWord[]>(sql, (err, result) => {
      if (err) {
        throw err;
      }

      if (result[0].word) {
        word = result[0].word;
        roomSettings[room].word = word;

        // get the user who is drawing
        const firstdrawer = rooms[room].find((user) => user.firstdraw);

        // assign roles to each user through a private message to each socket in the room
        rooms[room].forEach((user) => {
          io.to(user.id).emit(
            "assign_role",
            user.role,
            user.firstdraw,
            user.role === "artist" ? word : null,
            firstdrawer?.name
          );
        });
      } else {
        throw err;
      }
    });
  });

  // callback for when drawing is done
  socket.on(
    "done_drawing",
    (
      room: string,
      nickname: string,
      word: string,
      round: number,
      callback: (shouldDrawNext: boolean, round: number) => void
    ) => {
      let newround = round;
      // find a random user who has not drawn yet
      const nextdrawer = rooms[room].find((user) => !user.hasDrawn);
      if (!nextdrawer) {
        // if no one left to draw, increment the round number
        newround++;
        // if round is >= 2, then 2 rounds are complete, so end the game
        if (newround >= roomSettings[room].numberRounds) {
          // reset hasDrawn, firstDraw for everyone
          rooms[room].forEach((user) => {
            user.hasDrawn = false;
            user.firstdraw = false;
            user.fooled = false;
          });
          io.to(room).emit("game_end");
          io.to(room).emit("show_public_word", roomSettings[room].word);
          return;
        }
        // otherwise, reset the hasDrawn flag for everyone
        rooms[room].forEach((user) => (user.hasDrawn = false));
        // and find a new drawer
        const newdrawer = rooms[room].find((user) => !user.hasDrawn);

        if (newdrawer) {
          callback(newdrawer.name === nickname, newround);
          // emit to all other users the new drawer
          io.to(room).emit("new_drawer", newdrawer.name, newround);
          newdrawer.hasDrawn = true;
        }
      } else {
        // this means the round is not over, since more people need to draw
        callback(nextdrawer.name === nickname, newround);
        // emit to all other users the new drawer
        io.to(room).emit("new_drawer", nextdrawer.name, newround);
        nextdrawer.hasDrawn = true;
      }
    }
  );

  socket.on(
    "send_vote",
    (
      room: string,
      votefor: string,
      nickname: string,
      userScores: Array<userScore>,
      callback: (
        scores: Array<userScore>,
        imposter: string,
        users_fooled: number
      ) => void
    ) => {
      // save the callback function to be called when all players are done voting.
      // this is to prevent the server from sending the scores to the players before all players have voted
      if (!rooms[room]) {
        return;
      }
      let user_fooled = 0;

      rooms[room].forEach((user) => {
        if (user.name === nickname) {
          user.voteCallback = callback;
          // compute new scores for the user in the room (just this socket)
          if (!user.score) {
            user.score = 0;
          }
          if (
            rooms[room].find((u) => u.role === "imposter")?.name === votefor
          ) {
            if (user.role !== "imposter") {
              user.score += 100;
            }
          } else {
            if (user.role !== "imposter") {
              user_fooled++;
              user.fooled = true;
            }
          }
        }
      });

      // set the imposter score from this players result
      rooms[room].forEach((user) => {
        if (user.role === "imposter") {
          if (!user.score) {
            user.score = 0;
          }
          user.score += 50 * user_fooled;
        }
      });

      // check if all players have voted
      const allVoted = rooms[room].every((user) => user.voteCallback);
      if (allVoted) {
        // create an array of UserScore objects to send to the client
        const scores: Array<userScore> = rooms[room].map((user) => {
          return {
            name: user.name || "",
            score: user.score || 0,
          };
        });
        // run the callback for each user
        rooms[room].forEach((user) => {
          if (user.voteCallback) {
            user.voteCallback(
              scores,
              rooms[room].find((u) => u.role === "imposter")?.name || "",
              rooms[room].reduce((acc, u) => (u.fooled ? acc + 1 : acc), 0)
            );
          }
        });
      }
    }
  );
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
