const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host:'localhost',
  user:'root',
  password:'anmol',
  database:'fitfuel'
});

db.connect(()=>console.log("MySQL Connected"));

/* REGISTER */
app.post('/register', async (req,res)=>{
  const {name,email,password} = req.body;
  const hash = await bcrypt.hash(password,10);

  db.query(
    "INSERT INTO users(name,email,password) VALUES(?,?,?)",
    [name,email,hash],
    err=>{
      if(err) return res.send({error:"User already exists"});
      res.send({success:true});
    }
  );
});

/* LOGIN */
app.post('/login',(req,res)=>{
  const {email,password} = req.body;

  db.query("SELECT * FROM users WHERE email=?",[email], async (err,r)=>{
    if(r.length===0) return res.send({error:"User not found"});

    const ok = await bcrypt.compare(password,r[0].password);
    if(!ok) return res.send({error:"Wrong password"});

    res.send({
      userId:r[0].id,
      name:r[0].name,
      email:r[0].email
    });
  });
});

/* SAVE PROFILE */
app.post('/profile',(req,res)=>{
  const {userId,age,height,weight,gender,activity,goal} = req.body;

  db.query(
    "DELETE FROM profiles WHERE user_id=?",[userId],
    ()=>{
      db.query(
        "INSERT INTO profiles VALUES(?,?,?,?,?,?,?)",
        [userId,age,height,weight,gender,activity,goal],
        ()=>res.send({success:true})
      );
    }
  );
});

/* DIET CALCULATION */
app.post('/diet',(req,res)=>{
  const {age,height,weight,gender,activity,goal} = req.body;

  let bmr = gender==="male"
    ? 10*weight + 6.25*height - 5*age + 5
    : 10*weight + 6.25*height - 5*age - 161;

  const act = {low:1.2, medium:1.55, high:1.9};
  let calories = bmr * act[activity];
  if(goal==="bulk") calories+=300;
  if(goal==="cut") calories-=300;

  res.send({
    calories:Math.round(calories),
    protein:Math.round(weight*2),
    carbs:Math.round(calories*0.5/4),
    fats:Math.round(calories*0.25/9)
  });
});

app.listen(3000,()=>console.log("Server running on 3000"));
