import connection from "./db.js";

// DANGER - reset the database wordlist table
let sql = `DELETE FROM wordlist WHERE 1`;
connection.query(sql, function (err, result) {
  if (err) {
    console.log(err);
  } else {
    console.log("Table truncated");
  }
});

connection.end();
