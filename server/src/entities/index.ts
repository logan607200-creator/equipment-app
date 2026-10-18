import {
  Column, CreateDateColumn, Entity, Index, ManyToOne, JoinColumn, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import type { Role } from '../common/roles';

// 금액은 모두 원 단위 정수.

@Entity('accounts')
@Index(['phone', 'role'], { unique: true })
export class Account {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() phone: string;
  @Column({ type: 'varchar' }) role: Role;
  @Column({ type: 'varchar', nullable: true }) name: string | null;
  @CreateDateColumn() createdAt: Date;
}

export type PricingModel = 'DISTANCE' | 'TIME';

/** 장비 종류. 새 업종은 이 표에 행을 추가하면 된다. */
@Entity('equipment_types')
export class EquipmentType {
  @Column({ primary: true }) code: string;
  @Column() name: string;
  @Column({ type: 'varchar' }) pricingModel: PricingModel;
  /** 이 장비의 규격 항목 (예: tonnage, heightM) */
  @Column({ type: 'jsonb', default: [] }) specKeys: string[];
  /** 요금 가정값. 구조는 catalog/fare.ts 참고 */
  @Column({ type: 'jsonb' }) rates: Record<string, any>;
  @Column({ default: 0 }) sortOrder: number;
  @Column({ default: true }) active: boolean;
}

/** 이용자(공급자) 프로필 */
@Entity('providers')
export class Provider {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) accountId: string;
  @Column({ type: 'varchar', nullable: true }) companyName: string | null;
  @Column({ type: 'varchar', nullable: true }) bizRegNo: string | null;
  /** 운영자가 서류를 확인해야 호출을 받을 수 있다 */
  @Column({ default: false }) verified: boolean;
  @Column({ default: false }) online: boolean;
  @Column({ type: 'uuid', nullable: true }) activeEquipmentId: string | null;
  @Column({ type: 'uuid', nullable: true }) currentJobId: string | null;
  /** 예약 호출을 받을 차고지 위치 */
  @Column({ type: 'double precision', nullable: true }) baseLat: number | null;
  @Column({ type: 'double precision', nullable: true }) baseLng: number | null;
  @Column({ type: 'double precision', default: 0 }) ratingSum: number;
  @Column({ default: 0 }) ratingCount: number;
  @Column({ default: 0 }) offersReceived: number;
  @Column({ default: 0 }) offersAccepted: number;
  @Column({ default: 0 }) cancelCount: number;
  @CreateDateColumn() createdAt: Date;

  get rating(): number {
    return this.ratingCount ? this.ratingSum / this.ratingCount : 4.5;
  }
  get acceptanceRate(): number {
    return this.offersReceived ? this.offersAccepted / this.offersReceived : 0.5;
  }
}

@Entity('provider_equipment')
export class ProviderEquipment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() providerId: string;
  @Column() typeCode: string;
  @Column({ type: 'varchar', nullable: true }) plateNo: string | null;
  /** 규격 값 (예: { tonnage: 25 }, { heightM: 45 }) */
  @Column({ type: 'jsonb', default: {} }) spec: Record<string, number>;
  /** 렉카: 견인 가능한 차종 */
  @Column({ type: 'jsonb', default: [] }) towClasses: string[];
  @Column({ default: true }) active: boolean;
}

export type JobStatus = 'REQUESTED' | 'MATCHED' | 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

@Entity('jobs')
@Index(['status'])
export class Job {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() customerId: string;
  @Column() typeCode: string;
  /** 장비별 세부 옵션 (렉카: serviceKind, vehicleClass / 그 외: durationUnit, durationQty 등) */
  @Column({ type: 'jsonb', default: {} }) options: Record<string, any>;
  /** 필요한 최소 규격 (예: { tonnage: 25 }) */
  @Column({ type: 'jsonb', default: {} }) requiredSpec: Record<string, number>;
  @Column({ type: 'double precision' }) lat: number;
  @Column({ type: 'double precision' }) lng: number;
  @Column({ type: 'varchar', nullable: true }) address: string | null;
  @Column({ type: 'double precision', nullable: true }) destLat: number | null;
  @Column({ type: 'double precision', nullable: true }) destLng: number | null;
  @Column({ type: 'varchar', nullable: true }) destAddress: string | null;
  @Column({ type: 'varchar', nullable: true }) memo: string | null;
  /** null이면 즉시 호출, 값이 있으면 예약 호출 */
  @Column({ type: 'timestamptz', nullable: true }) scheduledAt: Date | null;
  @Column({ type: 'varchar', default: 'REQUESTED' }) status: JobStatus;
  @Column({ type: 'uuid', nullable: true }) providerId: string | null;
  @Column({ type: 'uuid', nullable: true }) equipmentId: string | null;
  @Column({ type: 'jsonb' }) estimate: Record<string, any>;
  @Column({ type: 'int', nullable: true }) finalFare: number | null;
  @Column({ type: 'int', default: 0 }) cancelFee: number;
  @Column({ type: 'varchar', nullable: true }) cancelledBy: Role | null;
  /** 자동 배차에 실패해 운영자 확인이 필요한 호출 */
  @Column({ default: false }) unassignedAlert: boolean;
  /** 배차를 (다시) 시작한 시각. 반경 확대 단계를 이 시각부터 계산한다. */
  @Column({ type: 'timestamptz', default: () => 'now()' }) dispatchStartedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) matchedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) arrivedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CLOSED' | 'CANCELLED_BY_PROVIDER';

@Entity('job_offers')
@Index(['jobId', 'providerId'], { unique: true })
export class JobOffer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() jobId: string;
  @Index() @Column() providerId: string;
  @Column() equipmentId: string;
  @Column({ type: 'int' }) etaSec: number;
  @Column({ type: 'double precision' }) distanceKm: number;
  @Column({ type: 'varchar', default: 'PENDING' }) status: OfferStatus;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) respondedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export type AdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** 현장에서 바뀌는 요금. 사용자가 승인해야만 청구된다. */
@Entity('fare_adjustments')
export class FareAdjustment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() jobId: string;
  @Column({ type: 'int' }) amount: number;
  @Column() reason: string;
  @Column({ type: 'varchar', default: 'PENDING' }) status: AdjustmentStatus;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('ratings')
export class Rating {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) jobId: string;
  @Column() providerId: string;
  @Column({ type: 'int' }) score: number;
  @Column({ type: 'varchar', nullable: true }) comment: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) jobId: string;
  @Column() providerId: string;
  @Column({ type: 'int' }) amount: number;
  @Column({ type: 'int' }) commission: number;
  @Column({ type: 'int' }) providerPayout: number;
  @Column({ type: 'varchar' }) status: 'CAPTURED' | 'FAILED' | 'REFUNDED';
  /** MOCK: PG 키가 없을 때 기록만 한 결제, TOSS: 토스페이먼츠 자동결제 */
  @Column({ type: 'varchar', default: 'MOCK' }) method: 'MOCK' | 'TOSS';
  /** 출동 후 취소 수수료인지 작업 요금인지 */
  @Column({ type: 'varchar', default: 'FARE' }) kind: 'FARE' | 'CANCEL_FEE';
  /** PG 거래 키 (토스 paymentKey) */
  @Column({ type: 'varchar', nullable: true }) pgTxId: string | null;
  @Column({ type: 'varchar', nullable: true }) failReason: string | null;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

/** 사용자가 등록한 결제 카드. 카드번호는 PG가 보관하고 우리는 빌링키와 가린 번호만 둔다. */
@Entity('payment_methods')
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() accountId: string;
  /** 토스 customerKey (계정마다 하나) */
  @Column() customerKey: string;
  @Column() billingKey: string;
  @Column({ type: 'varchar', nullable: true }) cardCompany: string | null;
  @Column({ type: 'varchar', nullable: true }) cardNumber: string | null;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

/** 푸시 알림을 받을 기기 */
@Entity('device_tokens')
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() accountId: string;
  @Column({ unique: true }) token: string;
  @Column({ type: 'varchar', default: 'unknown' }) platform: string;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

export const ENTITIES = [Account, EquipmentType, Provider, ProviderEquipment, Job, JobOffer, FareAdjustment, Rating, Payment, PaymentMethod, DeviceToken];
