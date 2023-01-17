import connection from "./db.js";

let sql =
  "SELECT * FROM wordlist WHERE category='animal' ORDER BY RAND() LIMIT 1";

connection.query(sql, (err, result) => {
  if (err) {
    console.log(err);
  } else {
    console.log(result);
  }
});

connection.end();
