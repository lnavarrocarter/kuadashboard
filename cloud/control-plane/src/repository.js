'use strict';

class MemoryRepository {
  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.subscriptions = new Map();
    this.webhookEvents = new Set();
  }

  async findUserById(id) { return this.users.get(id) || null; }
  async findUserByGoogleSub(googleSub) {
    return [...this.users.values()].find(user => user.googleSub === googleSub) || null;
  }
  async findUserByStripeCustomerId(customerId) {
    return [...this.users.values()].find(user => user.stripeCustomerId === customerId) || null;
  }
  async upsertUser(user) {
    const current = this.users.get(user.id) || {};
    const next = { ...current, ...user };
    this.users.set(next.id, next);
    return next;
  }
  async createSession(session) { this.sessions.set(session.tokenHash, session); return session; }
  async findSession(tokenHash) {
    const session = this.sessions.get(tokenHash);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      if (session) this.sessions.delete(tokenHash);
      return null;
    }
    return session;
  }
  async deleteSession(tokenHash) { this.sessions.delete(tokenHash); }
  async getSubscriptionByUserId(userId) { return this.subscriptions.get(userId) || null; }
  async upsertSubscription(userId, subscription) {
    const next = { ...subscription, userId };
    this.subscriptions.set(userId, next);
    return next;
  }
  async deleteSubscription(userId) { this.subscriptions.delete(userId); }
  async claimWebhookEvent(eventId, eventType, receivedAt) {
    if (this.webhookEvents.has(eventId)) return false;
    this.webhookEvents.add(eventId);
    return { eventId, eventType, receivedAt };
  }
  async releaseWebhookEvent(eventId) { this.webhookEvents.delete(eventId); }
}

class FirestoreRepository {
  constructor(firestore) {
    if (!firestore) throw new Error('firestore is required');
    this.firestore = firestore;
  }

  async findUserById(id) {
    const snapshot = await this.firestore.collection('users').doc(id).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }
  async findUserByGoogleSub(googleSub) {
    const snapshot = await this.firestore.collection('users').where('googleSub', '==', googleSub).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }
  async findUserByStripeCustomerId(customerId) {
    const snapshot = await this.firestore.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }
  async upsertUser(user) {
    const { id, ...data } = user;
    await this.firestore.collection('users').doc(id).set(data, { merge: true });
    return this.findUserById(id);
  }
  async createSession(session) {
    await this.firestore.collection('sessions').doc(session.tokenHash).set(session);
    return session;
  }
  async findSession(tokenHash) {
    const snapshot = await this.firestore.collection('sessions').doc(tokenHash).get();
    if (!snapshot.exists) return null;
    const session = snapshot.data();
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await snapshot.ref.delete();
      return null;
    }
    return session;
  }
  async deleteSession(tokenHash) { await this.firestore.collection('sessions').doc(tokenHash).delete(); }
  async getSubscriptionByUserId(userId) {
    const snapshot = await this.firestore.collection('subscriptions').doc(userId).get();
    return snapshot.exists ? snapshot.data() : null;
  }
  async upsertSubscription(userId, subscription) {
    const data = { ...subscription, userId };
    await this.firestore.collection('subscriptions').doc(userId).set(data, { merge: true });
    return data;
  }
  async deleteSubscription(userId) { await this.firestore.collection('subscriptions').doc(userId).delete(); }
  async claimWebhookEvent(eventId, eventType, receivedAt) {
    const ref = this.firestore.collection('webhookEvents').doc(eventId);
    try {
      await ref.create({ eventType, receivedAt });
      return { eventId, eventType, receivedAt };
    } catch (error) {
      if (error.code === 6 || error.code === 'already-exists') return false;
      throw error;
    }
  }
  async releaseWebhookEvent(eventId) { await this.firestore.collection('webhookEvents').doc(eventId).delete(); }
}

class DatastoreRepository {
  constructor(datastore) {
    if (!datastore) throw new Error('datastore is required');
    this.datastore = datastore;
  }

  key(kind, id) { return this.datastore.key([kind, id]); }
  async find(kind, id) {
    const [entity] = await this.datastore.get(this.key(kind, id));
    if (!entity) return null;
    const { [DatastoreRepository.ID_FIELD]: _storedId, ...data } = entity;
    return { id, ...data };
  }
  async findBy(kind, property, value) {
    const [entities] = await this.datastore.runQuery(
      this.datastore.createQuery(kind).filter(property, '=', value).limit(1),
    );
    if (!entities.length) return null;
    const entity = entities[0];
    const { [DatastoreRepository.ID_FIELD]: id, ...data } = entity;
    return { id, ...data };
  }
  async save(kind, id, data) {
    const { id: _ignoredId, [DatastoreRepository.ID_FIELD]: _storedId, ...payload } = data;
    await this.datastore.save({ key: this.key(kind, id), data: { ...payload, [DatastoreRepository.ID_FIELD]: id } });
    return { id, ...payload };
  }
  async delete(kind, id) { await this.datastore.delete(this.key(kind, id)); }

  async findUserById(id) { return this.find('KuaUser', id); }
  async findUserByGoogleSub(googleSub) { return this.findBy('KuaUser', 'googleSub', googleSub); }
  async findUserByStripeCustomerId(customerId) { return this.findBy('KuaUser', 'stripeCustomerId', customerId); }
  async upsertUser(user) {
    const current = await this.findUserById(user.id) || {};
    return this.save('KuaUser', user.id, { ...current, ...user });
  }
  async createSession(session) { return this.save('KuaSession', session.tokenHash, session); }
  async findSession(tokenHash) {
    const session = await this.find('KuaSession', tokenHash);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      if (session) await this.deleteSession(tokenHash);
      return null;
    }
    return session;
  }
  async deleteSession(tokenHash) { await this.delete('KuaSession', tokenHash); }
  async getSubscriptionByUserId(userId) { return this.find('KuaSubscription', userId); }
  async upsertSubscription(userId, subscription) { return this.save('KuaSubscription', userId, subscription); }
  async deleteSubscription(userId) { await this.delete('KuaSubscription', userId); }
  async claimWebhookEvent(eventId, eventType, receivedAt) {
    const transaction = this.datastore.transaction();
    await transaction.run();
    const key = this.key('KuaWebhookEvent', eventId);
    const [existing] = await transaction.get(key);
    if (existing) {
      await transaction.rollback();
      return false;
    }
    transaction.save({ key, data: { eventId, eventType, receivedAt } });
    await transaction.commit();
    return { eventId, eventType, receivedAt };
  }
  async releaseWebhookEvent(eventId) { await this.delete('KuaWebhookEvent', eventId); }
}

DatastoreRepository.ID_FIELD = '__kuaId';

function createFirestoreRepository({ projectId } = {}) {
  const { Firestore } = require('@google-cloud/firestore');
  return new FirestoreRepository(new Firestore(projectId ? { projectId } : undefined));
}

function createDatastoreRepository({ projectId } = {}) {
  const { Datastore } = require('@google-cloud/datastore');
  return new DatastoreRepository(new Datastore(projectId ? { projectId } : undefined));
}

function createCloudRepository({ projectId, mode = 'datastore' } = {}) {
  if (mode === 'firestore') return createFirestoreRepository({ projectId });
  if (mode === 'datastore') return createDatastoreRepository({ projectId });
  throw new Error(`Unsupported cloud database mode: ${mode}`);
}

module.exports = {
  DatastoreRepository,
  FirestoreRepository,
  MemoryRepository,
  createCloudRepository,
  createDatastoreRepository,
  createFirestoreRepository,
};
