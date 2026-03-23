import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

// --- CONFIGURATION & FALLBACKS ---
const dbFilename = process.env.DB_PATH ? process.env.DB_PATH.replace(/\.db$/, '.json') : 'memory.json';
const localDbPath = path.resolve(process.cwd(), dbFilename);
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

let firestore: admin.firestore.Firestore | null = null;

// Initialize Firebase if service-account.json exists
if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firestore = admin.firestore();
    console.log('☁️ Conectado exitosamente a Firebase Firestore.');
  } catch (error) {
    console.error('❌ Error al inicializar Firebase. Usando memoria local JSON:', error);
  }
} else {
    console.warn('⚠️ No se encontró service-account.json. Usando memoria local JSON.');
}

// --- INTERFACES ---
export interface MessageRow {
  user_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls: any[] | null;
  tool_call_id: string | null;
  timestamp: any; // Can be string (local) or Timestamp (firestore)
}

export type DbMessageInsert = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string | null;
  tool_calls?: any[] | null;
  tool_call_id?: string | null;
}

// --- LOCAL DB HELPERS ---
const readLocalDb = (): any[] => {
  if (!fs.existsSync(localDbPath)) return [];
  try {
    const data = fs.readFileSync(localDbPath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
};

const writeLocalDb = (data: any[]) => {
  fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf8');
};

// --- CORE API ---

export const saveMessage = async (userId: string, msg: DbMessageInsert): Promise<void> => {
  const newMsg = {
    user_id: userId,
    role: msg.role,
    content: msg.content || null,
    tool_calls: msg.tool_calls || null,
    tool_call_id: msg.tool_call_id || null,
    timestamp: new Date()
  };

  if (firestore) {
    try {
      await firestore.collection('conversations').doc(userId).collection('messages').add({
        ...newMsg,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    } catch (e) {
      console.error('Error guardando en Firestore, guardando localmente...', e);
    }
  }

  // Fallback o local
  const db = readLocalDb();
  db.push({ ...newMsg, timestamp: newMsg.timestamp.toISOString() });
  writeLocalDb(db);
};

export const getHistory = async (userId: string, limit: number = 30): Promise<Array<any>> => {
  if (firestore) {
    try {
      const snapshot = await firestore.collection('conversations')
        .doc(userId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        const m: any = { role: data.role };
        if (data.content !== null) m.content = data.content;
        if (data.tool_calls) m.tool_calls = data.tool_calls;
        if (data.tool_call_id) m.tool_call_id = data.tool_call_id;
        return m;
      });

      return messages.reverse();
    } catch (e) {
      console.error('Error leyendo de Firestore, usando local...', e);
    }
  }

  // Local read
  const db = readLocalDb();
  const userMessages = db.filter(row => row.user_id === userId);
  const rows = userMessages.slice(-limit);
  
  return rows.map(row => {
    const msg: any = { role: row.role };
    if (row.content !== null) msg.content = row.content;
    if (row.tool_calls) msg.tool_calls = row.tool_calls;
    if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
    return msg;
  });
};

export const clearHistory = async (userId: string): Promise<void> => {
  if (firestore) {
    try {
      const batchSize = 100;
      const collectionRef = firestore.collection('conversations').doc(userId).collection('messages');
      const query = collectionRef.orderBy('__name__').limit(batchSize);

      const deleteQueryBatch = async (query: any, resolve: any) => {
        const snapshot = await query.get();
        if (snapshot.size === 0) {
            resolve();
            return;
        }
        const batch = firestore!.batch();
        snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
        process.nextTick(() => deleteQueryBatch(query, resolve));
      };

      await new Promise((resolve, reject) => {
        deleteQueryBatch(query, resolve).catch(reject);
      });
      console.log(`Historial de Firebase borrado para el usuario: ${userId}`);
    } catch (e) {
      console.error('Error borrando en Firestore:', e);
    }
  }

  const db = readLocalDb();
  const newDb = db.filter(row => row.user_id !== userId);
  writeLocalDb(newDb);
};
