using System;
using Assets.Src.Interfaces;
using UnityEngine;
using System.Linq;
using Assets.src.interfaces;
using Assets.src.targeting;
using Assets.Src.ObjectManagement;
using Assets.Src.Turret;

namespace Assets.Src.Targeting
{
    //Detonator that detonates when in a certain range, but only if the exploder is approaching the target.
    public class ProximityApproachDetonator : IDetonator
    {
        private readonly Rigidbody _exploderRigidbody;
        private readonly float _detonationTimeToTarget;
        private readonly float _shrapnelSpeed;

        private IExploder _exploder;

        public ProximityApproachDetonator(IExploder exploder, Rigidbody exploderRigidBody, float detonationTimeToTarget, float shrapnelSpeed)
        {
            _exploderRigidbody = exploderRigidBody;
            _detonationTimeToTarget = detonationTimeToTarget;
            _shrapnelSpeed = shrapnelSpeed;
            _exploder = exploder;
        }

        public void AutoDetonate(PotentialTarget target)
        {
            if (ShouldDetonate(target))
            {
                Debug.Log(_exploderRigidbody + " is auto-detonating");
                DetonateNow();
            }
        }

        private bool ShouldDetonate(PotentialTarget target)
        {
            if(target == null)
            {
                return false;
            }

            Vector3 targetVelocity = target.TargetRigidbody == null ? Vector3.zero : target.TargetRigidbody.velocity;

            var relativeVelocity = _exploderRigidbody.velocity - targetVelocity;

            var reletiveLocation = target.TargetTransform.position - _exploderRigidbody.position;

            var approachAngle = Vector3.Angle(relativeVelocity, reletiveLocation);
            
            var approachVelocity = relativeVelocity.ComponentParalellTo(reletiveLocation);
            //var TangentialVelocity = velocity.ComponentPerpendicularTo(reletiveLocation);

            var shrapnelConeAngel = Math.Atan(_shrapnelSpeed / approachVelocity.magnitude);
            if(approachAngle > shrapnelConeAngel || approachAngle < -shrapnelConeAngel)
            {
                //Debug.Log("Target not in shrapnel cone");
                return false;
            }

            //var minShrapnelApproachSpeed = approachVelocity.magnitude - _shrapnelSpeed;

            var distance = reletiveLocation.magnitude;

            var timeToTaget = distance / approachVelocity.magnitude;

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