const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`FileFerryer server listening on port ${PORT}`);
});
