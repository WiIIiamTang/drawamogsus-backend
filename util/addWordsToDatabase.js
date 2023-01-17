import fs from "fs";
import { parse } from "csv-parse";
import connection from "./db.js";

let count = 0;

while (!connection) {
  setTimeout(() => {}, 1000);
}

// parse csv file
fs.createReadStream("words.csv")
  .pipe(parse({ delimiter: ",", from_line: 2 }))
  .on("data", (row) => {
    console.log(row);
    // backfill the database with words
    let sql = `INSERT INTO wordlist (word, category) VALUES ('${row[2]}', '${row[1]}')`;
    console.log(sql);
    connection.query(sql, function (err, result) {
      if (err) {
        console.log(err);
      } else {
        console.log("Record inserted");
        count++;
      }
    });
  })
  .on("end", () => {
    console.log("CSV file successfully processed");
    console.log(count + " records inserted");
    connection.end();
  })
  .on("error", (error) => {
    console.log(error);
  });
