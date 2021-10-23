using Assets.Src.Interfaces;
using System;
using UnityEngine;

namespace Assets.Src.Targeting
{
    //Detonator that detonates when in a certain range, but only if the exploder is approaching the target.
    public class ProximityApproachDetonator : IDetonator
    {
        private readonly Rigidbody _exploderRigidbody;
        private readonly float _detonationTimeToTarget;
        private readonly float _shrapnelSpeed;

        private readonly IExploder _exploder;

        public ProximityApproachDetonator(IExploder exploder, Rigidbody exploderRigidBody, float detonationTimeToTarget, float shrapnelSpeed)
        {
            _exploderRigidbody = exploderRigidBody;
            _detonationTimeToTarget = detonationTimeToTarget;
            _shrapnelSpeed = shrapnelSpeed;
            _exploder = exploder;
        }

        public void AutoDetonate(ITarget target)
        {
            if (ShouldDetonate(target))
            {
                //Debug.Log(_exploderRigidbody + " is auto-detonating");
                DetonateNow();
            }
        }

        private bool ShouldDetonate(ITarget target)
        {
            if (target == null)
            {
                return false;
            }

            var targetVelocity = target.Rigidbody == null ? Vector3.zero : target.Rigidbody.velocity;

            var relativeVelocity = _exploderRigidbody.velocity - targetVelocity;

            var relativeLocation = target.Transform.position - _exploderRigidbody.position;

            var approachAngle = Vector3.Angle(relativeVelocity, relativeLocation);

            var approachVelocity = relativeVelocity.ComponentParalellTo(relativeLocation);
            //var TangentialVelocity = velocity.ComponentPerpendicularTo(relativeLocation);

            var distance = relativeLocation.magnitude;

            float shrapnelConeAngel;
            float timeToTaget;
            if (approachVelocity.magnitude != 0)
            {
                shrapnelConeAngel = (float)Math.Atan(_shrapnelSpeed / approachVelocity.magnitude);
                timeToTaget = distance / approachVelocity.magnitude;
            }
            else
            {
                Debug.LogWarning("Avoided div0 error");
                shrapnelConeAngel = 0;
                timeToTaget = float.MaxValue;
            }

            if (approachAngle > shrapnelConeAngel)
            {
                //Debug.Log("Target not in shrapnel cone");
                return false;
            }

            //var minShrapnelApproachSpeed = approachVelocity.magnitude - _shrapnelSpeed;



            var shouldDetonate = timeToTaget < _detonationTimeToTarget;

            //if(shouldDetonate)
            //    Debug.Log("Detonating: Time to target " + timeToTaget);

            return shouldDetonate;
        }

        public void DetonateNow()
        {
            _exploder.ExplodeNow();
        }
    }
}