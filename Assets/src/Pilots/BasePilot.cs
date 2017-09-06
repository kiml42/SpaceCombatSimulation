using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Pilots
{
    public abstract class BasePilot : IPilot
    {
        public float LocationAimWeighting { get; set; }
        public Transform VectorArrow;

        public int StartDelay
        {
            get
            {
                return _startDelay;
            }
            set
            {
                _startDelay = value;
            }
        }

        public int TurningStartDelay
        {
            get
            {
                return _turningStartDelay;
            }
            set
            {
                _turningStartDelay = value;
            }
        }
        private int _startDelay = 0;
        private int _turningStartDelay;

        protected List<Transform> _engines = new List<Transform>();

        public float RemainingFuel { get; protected set; }

        protected bool ShouldTurn()
        {
            TurningStartDelay--;
            StartDelay--;
            return TurningStartDelay <= 0;
        }

        protected float _shootAngle;

        protected ITorqueApplier _torqueApplier;

        protected Rigidbody _pilotObject;

        protected bool HasFuel()
        {
            //Debug.Log("RemainignFule:" + RemainingFuel);
            var hasFuel = RemainingFuel > 0 && StartDelay <= 0;
            if (!hasFuel)
            {
                _torqueApplier.Deactivate();
            }
            else
            {
                _torqueApplier.Activate();
            }
            return hasFuel;
        }

        protected Vector3 VectorTowardsTargetInWorldSpace(PotentialTarget target)
        {
            if (_pilotObject != null && target != null && target.TargetTransform.IsValid())
            {
                var location = target.TargetTransform.position - _pilotObject.position;
                return location;
            }

            //if (target == null || target.TargetTransform.IsInvalid())
            //{
            //    Debug.Log("Target transform is invalid");
            //}
            if (_pilotObject == null)
            {
                Debug.Log("_pilotObject is null");
            }
            return Vector3.zero;
        }

        protected Vector3 VectorToCancelLateralVelocityInWorldSpace(PotentialTarget target)
        {
            var vectorTowardsTarget = VectorTowardsTargetInWorldSpace(target);
            var targetReletiveVelocity = WorldSpaceReletiveVelocityOfTarget(target);

            return targetReletiveVelocity.ComponentPerpendicularTo(vectorTowardsTarget);
        }

        protected Vector3 WorldSpaceReletiveVelocityOfTarget(PotentialTarget target)
        {
            if (target == null)
            {
                return Vector3.zero;
            }
            var targetsVelocity = target.TargetRigidbody == null ? Vector3.zero : target.TargetRigidbody.velocity;
            var ownVelocity = _pilotObject.velocity;
            return targetsVelocity - ownVelocity;
        }

        protected void SetEngineActivationState(bool fire)
        {
            if (fire && HasFuel())
            {
                foreach (var engine in _engines)
                {
                    engine.SendMessage("TurnOn");
                    //every engine uses 1 fuel
                    RemainingFuel--;
                }
            }
            else
            {
                foreach (var engine in _engines)
                {
                    engine.SendMessage("TurnOff");
                }
            }
        }

        protected void RemoveNullEngines()
        {
            _engines = _engines.Where(t => t.IsValid()).Distinct().ToList();
        }

        protected bool IsAimedAtWorldVector(Vector3 worldSpaceVector)
        {
            if (_pilotObject != null)
            {
                var angle = Vector3.Angle(_pilotObject.transform.forward, worldSpaceVector);
                return angle < _shootAngle;
            }

            //Debug.Log("No Engines (IsAimedAtWorldVector)");
            return false;
        }

        public abstract void Fly(PotentialTarget target);
    }
}
