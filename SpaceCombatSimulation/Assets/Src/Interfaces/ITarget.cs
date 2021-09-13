﻿using Assets.Src.Targeting;
using UnityEngine;

namespace Assets.Src.Interfaces
{
    public interface ITarget
    {
        string Team { get; }
        Transform Transform { get; }
        Rigidbody Rigidbody { get; }
        ShipType Type { get; }

        /// <summary>
        /// True if ships should maneuverer towards or away from this (or go round and round it if they want to).
        /// </summary>
        bool NavigationalTarget { get; }

        /// <summary>
        /// True of turrets and missiles should try to kill this if it's an enemy.
        /// </summary>
        bool AtackTarget { get; }

        /// <summary>
        /// Sets the team to the given value and updates all required references.
        /// </summary>
        /// <param name="newTeam"></param>
        void SetTeam(string newTeam);

        /// <summary>
        /// Sets the targetable object that should be used as the source for this object's team.
        /// </summary>
        /// <param name="teamSource"></param>
        void SetTeamSource(ITarget teamSource);
    }
}
