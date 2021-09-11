using Assets.Src.Interfaces;
using UnityEngine;

public class TargetIndicator : MonoBehaviour, IDeactivatable
{
    public Transform SourceObject;
    public LineRenderer TargetingLine;
    public IKnowsCurrentTarget TargetKnower;
    private bool _isActive = false;

    public void Deactivate()
    {
        _isActive = false;
    }

    // Use this for initialization
    void Start ()
    {
        if(TargetKnower == null)
            TargetKnower = GetComponentInParent<IKnowsCurrentTarget>();

        if(TargetingLine == null)
            TargetingLine = GetComponent<LineRenderer>();

        if(SourceObject == null)
            SourceObject = transform.parent;
        if (SourceObject == null)
            SourceObject =  transform;

        TargetingLine.useWorldSpace = true;

        //transform.parent = null; //uncomment to separate indicator lines from their parents so the parent can be easily focused.
    }
	
	// Update is called once per frame
	void Update () {
        if(_isActive && SourceObject != null && TargetKnower != null)
        {
            if(TargetKnower.CurrentTarget?.Transform != null)
            {
                TargetingLine.SetPosition(0, SourceObject.transform.position);
                TargetingLine.SetPosition(1, TargetKnower.CurrentTarget.Transform.position);
                TargetingLine.enabled = true;
                return;
            }
            else
            {
                TargetingLine.enabled = false;
            }
        } else
        {
            Debug.Log("Destroying disabled target line");
            Object.Destroy(transform.gameObject);
        }
    }
}
