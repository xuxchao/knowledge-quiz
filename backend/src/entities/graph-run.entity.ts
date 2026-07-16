import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum GraphRunStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Entity('graph_runs')
@Index('UQ_graph_runs_graph_idempotency', ['graphName', 'idempotencyKey'], { unique: true })
@Index('IDX_graph_runs_claim', ['status', 'availableAt', 'leaseExpiresAt'])
export class GraphRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  graphName: string;

  @Column({ type: 'uuid' })
  aggregateId: string;

  @Column({ type: 'varchar' })
  idempotencyKey: string;

  @Column({ type: 'varchar', enum: GraphRunStatus, default: GraphRunStatus.QUEUED })
  status: GraphRunStatus;

  @Column({ type: 'jsonb' })
  input: Record<string, unknown>;

  @Column({ type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  availableAt: Date;

  @Column({ type: 'varchar', nullable: true })
  leaseOwner: string | null;

  @Column({ type: 'timestamp', nullable: true })
  leaseExpiresAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lastNode: string | null;

  @Column({ type: 'integer', default: 0 })
  progress: number;

  @Column({ type: 'varchar', nullable: true })
  errorCode: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
