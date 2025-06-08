/**
 * Example of how to create a custom storage adapter for CloudTaskMQ
 * This demonstrates how to make the library truly storage-agnostic
 */
/**
 * Example of how to register your custom storage adapter with the CloudTaskMQ module
 */
import { Injectable, Module } from '@nestjs/common';
import { CloudTaskMQModule } from '@app/utils/nestjs-cloud-taskmq/src';

/**
 * Example custom storage adapter using a SQL database via TypeORM
 * You can adapt this to any storage mechanism that meets your needs
 */
@Injectable()
// export class SqlStorageAdapter implements IStateStorageAdapter {
//   private readonly logger = new Logger(SqlStorageAdapter.name);
//
//   constructor(
//     // In a real implementation, you would inject your database connection/repository
//     private readonly taskRepository: any,
//   ) {}
//
//   /**
//    * Initialize the storage adapter
//    */
//   async initialize(): Promise<void> {
//     this.logger.log('Initializing SQL storage adapter');
//     // In a real implementation, you might create tables, verify connection, etc.
//   }
//
//   /**
//    * Create a task record in the database
//    */
//   async createTask(
//     task: Omit<ITask, 'createdAt' | 'updatedAt'>,
//   ): Promise<ITask> {
//     const now = new Date();
//     const fullTask: ITask = {
//       ...task,
//       createdAt: now,
//       updatedAt: now,
//     };
//
//     // In a real implementation, you would save to your database
//     // const savedTask = await this.taskRepository.save(fullTask);
//
//     return fullTask;
//   }
//
//   /**
//    * Retrieve a task by ID
//    */
//   // async getTaskById(taskId: string): Promise<ITask | null> {
//   //   // In a real implementation, you would query your database
//   //   // return await this.taskRepository.findOne({ where: { taskId } });
//   //   return null;
//   // }
//
//   /**
//    * Update a task's status and optional additional data
//    */
//   async updateTaskStatus(
//     taskId: string,
//     status: TaskStatus,
//     additionalData?: Partial<ITask>,
//   ): Promise<ITask | null> {
//     // Get existing task
//     const task = await this.getTaskById(taskId);
//     if (!task) return null;
//
//     // Build update data
//     const updateData: any = {
//       status,
//       ...additionalData,
//       updatedAt: new Date(),
//     };
//
//     // Add timestamps based on status
//     if (status === TaskStatus.ACTIVE && !task.startedAt) {
//       updateData.startedAt = new Date();
//     } else if (status === TaskStatus.COMPLETED && !task.completedAt) {
//       updateData.completedAt = new Date();
//     }
//
//     // In a real implementation, you would update your database
//     // await this.taskRepository.update({ taskId }, updateData);
//     // return await this.getTaskById(taskId);
//
//     return { ...task, ...updateData };
//   }
//
//   /**
//    * Acquire a lock on a task for processing
//    */
//   // async acquireTaskLock(
//   //   taskId: string,
//   //   workerId: string,
//   //   lockDurationMs: number,
//   // ): Promise<boolean> {
//   //   const lockedUntil = new Date(Date.now() + lockDurationMs);
//   //
//   //   // In a real implementation, you would use database-specific locking mechanisms
//   //   // For example, in SQL you might use a transaction with a SELECT FOR UPDATE
//   //   // Or you could use optimistic locking with a version field
//   //
//   //   // For example, pseudo-code for a SQL transaction:
//   //   // let success = false;
//   //   // await this.repository.manager.transaction(async (manager) => {
//   //   //   const task = await manager.findOne(TaskEntity, {
//   //   //     where: {
//   //   //       taskId,
//   //   //       lockedUntil: IsNull() // Or lockedUntil < current time
//   //   //     },
//   //   //     lock: { mode: 'pessimistic_write' }
//   //   //   });
//   //   //
//   //   //   if (task) {
//   //   //     await manager.update(TaskEntity, { taskId }, {
//   //   //       status: TaskStatus.ACTIVE,
//   //   //       workerId,
//   //   //       lockedUntil,
//   //   //       startedAt: new Date()
//   //   //     });
//   //   //     success = true;
//   //   //   }
//   //   // });
//   //   // return success;
//   //
//   //   return true; // Placeholder for example
//   // }
//
//   /**
//    * Release a lock on a task
//    */
//   // async releaseTaskLock(taskId: string, workerId: string): Promise<boolean> {
//   //   // In a real implementation, you would update your database to release the lock
//   //   // return (await this.taskRepository.update(
//   //   //   { taskId, workerId },
//   //   //   { lockedUntil: null, workerId: null }
//   //   // )).affected > 0;
//   //
//   //   return true; // Placeholder for example
//   // }
//
//   /**
//    * Find tasks matching criteria
//    */
//   // async findTasks(options: TaskQueryOptions): Promise<ITask[]> {
//   //   // const {
//   //   //   status,
//   //   //   queueName,
//   //   //   skip = 0,
//   //   //   limit = 100,
//   //   //   sort = { createdAt: 'desc' },
//   //   // } = options;
//   //
//   //   // In a real implementation, you would query your database with these filters
//   //   // const whereClause: any = {};
//   //   // if (status) whereClause.status = status;
//   //   // if (queueName) whereClause.queueName = queueName;
//   //   //
//   //   // const sortOrder = Object.entries(sort).map(([key, value]) => {
//   //   //   return { [key]: value.toUpperCase() };
//   //   // });
//   //   //
//   //   // return await this.taskRepository.find({
//   //   //   where: whereClause,
//   //   //   skip,
//   //   //   take: limit,
//   //   //   order: sortOrder
//   //   // });
//   //
//   //   return []; // Placeholder for example
//   // }
//
//   /**
//    * Count tasks matching criteria
//    */
//   // async countTasks(options: TaskQueryOptions): Promise<number> {
//   //   // const { status, queueName } = options;
//   //
//   //   // In a real implementation, you would count from your database
//   //   // const whereClause: any = {};
//   //   // if (status) whereClause.status = status;
//   //   // if (queueName) whereClause.queueName = queueName;
//   //   //
//   //   // return await this.taskRepository.count({ where: whereClause });
//   //
//   //   return 0; // Placeholder for example
//   // }
//
//   /**
//    * Delete a task
//    */
//   async deleteTask(): Promise<boolean> {
//     // In a real implementation, you would delete from your database
//     // return (await this.taskRepository.delete({ taskId })).affected > 0;
//
//     return true; // Placeholder for example
//   }
// }

@Module({
  imports: [
    CloudTaskMQModule.forRoot({
      projectId: 'my-gcp-project',
      location: 'us-central1',
      defaultProcessorUrl: 'https://my-app.example.com/api/cloud-tasks',
      queues: [
        // Queue configurations...
      ],
      storageAdapter: 'custom', // This value doesn't matter when providing a custom adapter
      storageOptions: {
        // Your custom options
      },
    }),
  ],
  providers: [
    // Register your custom storage adapter
    // {
    //   provide: CLOUD_TASKMQ_STORAGE_ADAPTER,
    //   useClass: SqlStorageAdapter,
    // },
    // Other providers...
  ],
})
export class CustomStorageModule {}
