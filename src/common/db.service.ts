import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPool, Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { dbConfig } from './config';
import { applyDatabaseTablePrefix } from './table-prefix';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  onModuleInit(): void {
    this.pool = createPool({
      ...dbConfig,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      namedPlaceholders: false,
      dateStrings: true
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async query<T extends RowDataPacket = RowDataPacket>(sql: string, values: any[] = []): Promise<T[]> {
    const [rows] = await this.pool.query<T[]>(this.withTablePrefix(sql), values);
    return rows;
  }

  async execute(sql: string, values: any[] = []): Promise<ResultSetHeader> {
    const [result] = await this.pool.execute<ResultSetHeader>(this.withTablePrefix(sql), values);
    return result;
  }

  async transaction<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await run(this.withTablePrefixConnection(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private withTablePrefix(sql: string): string {
    return applyDatabaseTablePrefix(sql);
  }

  private withTablePrefixConnection(connection: PoolConnection): PoolConnection {
    return new Proxy(connection, {
      get: (target, property, receiver) => {
        if (property === 'query') {
          return (sql: unknown, values?: unknown) => {
            if (typeof sql === 'string') {
              return target.query(this.withTablePrefix(sql), values as any);
            }
            return target.query(sql as any, values as any);
          };
        }

        if (property === 'execute') {
          return (sql: unknown, values?: unknown) => {
            if (typeof sql === 'string') {
              return target.execute(this.withTablePrefix(sql), values as any);
            }
            return target.execute(sql as any, values as any);
          };
        }

        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    }) as PoolConnection;
  }
}
