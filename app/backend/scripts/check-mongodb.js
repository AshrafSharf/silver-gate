import dotenv from 'dotenv';
dotenv.config({ override: true });
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to:', process.env.MONGODB_URI);

const db = mongoose.connection;

// Check synced exercises with timestamps
const lessonRefIds = [
  '69799d65bd3d1a75dd04fb24',
  '69799d654c137ec2bc04fb39'
];

console.log('\nSynced exercises with timestamps:');
for (const refId of lessonRefIds) {
  const exercise = await db.collection('exercise').findOne({
    _id: new mongoose.Types.ObjectId(refId)
  });
  if (exercise) {
    console.log(`\n_id: ${exercise._id}`);
    console.log(`  name: ${exercise.name}`);
    console.log(`  created_at: ${exercise.created_at}`);
    console.log(`  updated_at: ${exercise.updated_at}`);
  }
}

// Check a synced exercise_item
console.log('\nFirst synced exercise_item with timestamps:');
const item = await db.collection('exercise_item').findOne({
  'exercise.$id': new mongoose.Types.ObjectId('69799d65bd3d1a75dd04fb24')
});
if (item) {
  console.log(`_id: ${item._id}`);
  console.log(`  question_label: ${item.question_label}`);
  console.log(`  created_at: ${item.created_at}`);
  console.log(`  updated_at: ${item.updated_at}`);
}

await mongoose.disconnect();
