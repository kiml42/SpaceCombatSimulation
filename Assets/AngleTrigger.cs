using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class AngleTrigger : MonoBehaviour, IFireControl
{
    private IKnowsCurrentTarget _targetChoosingMechanism;
    public float ShootAngle = 10;
    public Rigidbody AimingObject;
    private IFireControl _fireControl;
    private float? _projectileSpeed;

    // Use this for initialization
    void Start ()
    {
        var speedKnower = GetComponent("IKnowsProjectileSpeed") as IKnowsProjectileSpeed;
        _targetChoosingMechanism = GetComponent("IKnowsCurrentTarget") as IKnowsCurrentTarget;
        _projectileSpeed = speedKnower != null ? speedKnower.ProjectileSpeed : null;
    }

    public bool ShouldShoot(Target target)
    {
        if (target != null)
        {
            var location = target.LocationInOthersSpace(AimingObject, _projectileSpeed);

            var angle = Vector3.Angle(location, Vector3.forward);

            return angle < ShootAngle;
        }
        return false;
    }

    public bool ShouldShoot()
    {
        return ShouldShoot(_targetChoosingMechanism.CurrentTarget);
    }
}
