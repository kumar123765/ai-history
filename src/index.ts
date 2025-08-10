import express, { Request, Response } from 'express';
import cors from 'cors';
import runEventsFlow from './flow.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.send({ status: 'ok' });
});

app.post('/events', async (req: Request, res: Response) => {
  try {
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Missing date' });
    }

    const result = await runEventsFlow(date);
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    console.error('Error:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
