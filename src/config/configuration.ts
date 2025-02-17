export default () => ({
  database: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL,
    fileProcessingQueue: process.env.FILE_PROCESSING_QUEUE,
  },
});
