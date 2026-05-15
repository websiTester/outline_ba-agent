"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "conversations",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.UUIDV4,
          },
          title: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "New conversation",
          },
          userId: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          workspaceId: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex(
        "conversations",
        ["userId", "workspaceId"],
        { transaction, name: "ix_conversations_user_workspace" }
      );

      await queryInterface.createTable(
        "messages",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.UUIDV4,
          },
          conversationId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: "conversations", key: "id" },
            onDelete: "CASCADE",
          },
          role: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          content: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex(
        "messages",
        ["conversationId", "createdAt"],
        { transaction, name: "ix_messages_conversation_created" }
      );
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("messages", { transaction });
      await queryInterface.dropTable("conversations", { transaction });
    });
  },
};
